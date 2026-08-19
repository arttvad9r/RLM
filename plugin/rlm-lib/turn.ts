/**
 * Turn-level RLM governor (host side).
 *
 * One in-memory budget per root user turn. ToolContext.messageID is the pinned
 * OpenCode SDK's assistant-message ID, so turn identity is resolved as the
 * nearest preceding user message for that exact assistant message rather than
 * from whichever user message happens to be latest when an async lookup ends.
 * Session cache entries are evicted only from the authoritative OpenCode
 * session.deleted lifecycle event; no TTL/LRU can reset active authority.
 */
import {
  MAX_CHILD_CALLS_PER_TURN,
  MAX_CONTEXT_CALLS_PER_TURN,
  MAX_CONTEXT_CHARS_PER_TURN,
  MAX_RLM_EXECS_PER_TURN,
  MAX_RLM_WALL_MS_PER_TURN,
} from "./constants.ts"
import { RlmError } from "./errors.ts"

const TEST_TURN_WALL_MS = Number(process.env.RLM_TEST_TURN_WALL_MS) || 0
const TEST_TURN_EXECS = Number(process.env.RLM_TEST_TURN_EXECS) || 0
const TEST_TURN_CTX_CALLS = Number(process.env.RLM_TEST_TURN_CTX_CALLS) || 0
const TEST_TURN_CTX_CHARS = Number(process.env.RLM_TEST_TURN_CTX_CHARS) || 0

export interface TurnSnapshot {
  turnId: string
  execCount: number
  childCallCount: number
  contextCallCount: number
  contextCharsSent: number
  wallMsUsed: number
  execsRemaining: number
  childCallsRemaining: number
  contextCallsRemaining: number
  contextCharsRemaining: number
  wallMsRemaining: number
}

interface TurnBudget {
  execCount: number
  childCallCount: number
  contextCallCount: number
  contextCharsSent: number
  wallMsUsed: number
  wallReservedMs: number
}

interface SessionCache {
  lastUserMessageID: string | null
  lastMessageID: string | null
  lastMessageIndex: number
  activeExecCount: number
  budget: TurnBudget
}

type SessionMessagesClient = {
  session: {
    messages: (args: {
      path: { id: string }
      query: { directory: string }
    }) => Promise<{ error?: unknown; data?: Array<{ info?: { id?: string; role?: string } }> }>
  }
}

function emptyBudget(): TurnBudget {
  return { execCount: 0, childCallCount: 0, contextCallCount: 0, contextCharsSent: 0, wallMsUsed: 0, wallReservedMs: 0 }
}

async function userTurnForAssistantMessage(
  client: SessionMessagesClient,
  sessionID: string,
  directory: string,
  messageID: string,
): Promise<{ turnId: string; messageIndex: number }> {
  const res = await client.session.messages({ path: { id: sessionID }, query: { directory } })
  if (res.error) {
    throw new RlmError("RUNTIME_ERROR", "failed to resolve RLM user turn from parent session messages")
  }
  const messages = res.data ?? []
  const messageIndex = messages.findIndex((message) => message.info?.id === messageID)
  if (messageIndex < 0) {
    throw new RlmError("RUNTIME_ERROR", `failed to resolve RLM user turn: assistant message id not found: ${messageID}`)
  }
  const assistant = messages[messageIndex]?.info
  if (assistant?.role !== "assistant") {
    throw new RlmError("RUNTIME_ERROR", `failed to resolve RLM user turn: message id is not an assistant message: ${messageID}`)
  }
  for (let i = messageIndex - 1; i >= 0; i--) {
    const info = messages[i]?.info
    if (info?.role === "user" && typeof info.id === "string" && info.id.length > 0) {
      return { turnId: info.id, messageIndex }
    }
  }
  throw new RlmError("RUNTIME_ERROR", `failed to resolve RLM user turn: assistant message ${messageID} has no preceding user message id`)
}

export class TurnGovernor {
  private readonly cache = new Map<string, SessionCache>()
  private readonly beginExecTails = new Map<string, Promise<void>>()
  private readonly wallLimitMs: number

  constructor() {
    this.wallLimitMs = TEST_TURN_WALL_MS > 0 ? TEST_TURN_WALL_MS : MAX_RLM_WALL_MS_PER_TURN
  }

  private execsLimit(): number {
    return TEST_TURN_EXECS > 0 ? TEST_TURN_EXECS : MAX_RLM_EXECS_PER_TURN
  }

  ctxCallsLimit(): number {
    return TEST_TURN_CTX_CALLS > 0 ? TEST_TURN_CTX_CALLS : MAX_CONTEXT_CALLS_PER_TURN
  }

  ctxCharsLimit(): number {
    return TEST_TURN_CTX_CHARS > 0 ? TEST_TURN_CTX_CHARS : MAX_CONTEXT_CHARS_PER_TURN
  }

  private async withBeginExecLock<T>(sessionID: string, task: () => Promise<T>): Promise<T> {
    const previous = this.beginExecTails.get(sessionID) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    this.beginExecTails.set(sessionID, tail)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.beginExecTails.get(sessionID) === tail) this.beginExecTails.delete(sessionID)
    }
  }

  private async cacheFor(
    client: SessionMessagesClient,
    sessionID: string,
    directory: string,
    messageID: string,
  ): Promise<SessionCache> {
    let c = this.cache.get(sessionID)
    if (!c) {
      c = { lastUserMessageID: null, lastMessageID: null, lastMessageIndex: -1, activeExecCount: 0, budget: emptyBudget() }
      this.cache.set(sessionID, c)
    }
    if (c.lastMessageID === messageID && c.lastUserMessageID !== null) return c

    const resolved = await userTurnForAssistantMessage(client, sessionID, directory, messageID)
    if (resolved.messageIndex < c.lastMessageIndex) {
      throw new RlmError(
        "RUNTIME_ERROR",
        `refusing stale RLM tool call from assistant message ${messageID}; a newer assistant message is already authoritative`,
      )
    }
    if (resolved.messageIndex === c.lastMessageIndex && c.lastMessageID !== null && c.lastMessageID !== messageID) {
      throw new RlmError("RUNTIME_ERROR", "conflicting assistant message identity at the current RLM turn boundary")
    }
    if (c.lastUserMessageID !== resolved.turnId) {
      if (c.activeExecCount > 0) {
        throw new RlmError(
          "RUNTIME_ERROR",
          `refusing RLM user-turn transition while ${c.activeExecCount} prior-turn exec(s) are still active`,
        )
      }
      c.lastUserMessageID = resolved.turnId
      c.budget = emptyBudget()
    }
    c.lastMessageID = messageID
    c.lastMessageIndex = resolved.messageIndex
    return c
  }

  private wallAvailable(c: SessionCache): number {
    return Math.max(0, this.wallLimitMs - c.budget.wallMsUsed - c.budget.wallReservedMs)
  }

  private snap(c: SessionCache): TurnSnapshot {
    return {
      turnId: c.lastUserMessageID ?? "",
      execCount: c.budget.execCount,
      childCallCount: c.budget.childCallCount,
      contextCallCount: c.budget.contextCallCount,
      contextCharsSent: c.budget.contextCharsSent,
      wallMsUsed: c.budget.wallMsUsed,
      execsRemaining: Math.max(0, this.execsLimit() - c.budget.execCount),
      childCallsRemaining: Math.max(0, MAX_CHILD_CALLS_PER_TURN - c.budget.childCallCount),
      contextCallsRemaining: Math.max(0, this.ctxCallsLimit() - c.budget.contextCallCount),
      contextCharsRemaining: Math.max(0, this.ctxCharsLimit() - c.budget.contextCharsSent),
      wallMsRemaining: this.wallAvailable(c),
    }
  }

  async beginExec(
    client: SessionMessagesClient,
    sessionID: string,
    directory: string,
    messageID: string,
    requestedWallMs = 0,
  ): Promise<{ allowed: boolean; reason?: string; snapshot: TurnSnapshot; reservedWallMs: number }> {
    return this.withBeginExecLock(sessionID, async () => {
      const c = await this.cacheFor(client, sessionID, directory, messageID)
      const snap = this.snap(c)
      if (c.budget.execCount >= this.execsLimit()) {
        return { allowed: false, reason: `maximum ${this.execsLimit()} rlm_exec per user turn reached`, snapshot: snap, reservedWallMs: 0 }
      }
      const available = this.wallAvailable(c)
      if (available <= 0) {
        return { allowed: false, reason: "rlm_exec wall budget for this user turn is exhausted", snapshot: snap, reservedWallMs: 0 }
      }
      const safeRequest = Number.isFinite(requestedWallMs) && requestedWallMs > 0 ? requestedWallMs : 0
      const reservedWallMs = Math.min(safeRequest, available)
      c.budget.execCount++
      c.budget.wallReservedMs += reservedWallMs
      if (reservedWallMs > 0) c.activeExecCount++
      return { allowed: true, snapshot: this.snap(c), reservedWallMs }
    })
  }

  reserveExec(sessionID: string, ms: number): void {
    const c = this.cache.get(sessionID)
    if (!c) return
    const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0
    c.budget.wallReservedMs += safeMs
  }

  childAllowed(sessionID: string): boolean {
    const c = this.cache.get(sessionID)
    return Boolean(c && c.lastUserMessageID !== null && c.budget.childCallCount < MAX_CHILD_CALLS_PER_TURN)
  }

  registerChildStart(sessionID: string): void {
    const c = this.cache.get(sessionID)
    if (c && c.lastUserMessageID !== null) c.budget.childCallCount++
  }

  beginContextCall(sessionID: string): boolean {
    const c = this.cache.get(sessionID)
    if (!c || c.lastUserMessageID === null) return false
    c.budget.contextCallCount++
    return c.budget.contextCallCount <= this.ctxCallsLimit()
  }

  addContextChars(sessionID: string, chars: number): boolean {
    const c = this.cache.get(sessionID)
    if (!c || c.lastUserMessageID === null) return false
    if (!Number.isSafeInteger(chars) || chars < 0) return false
    if (c.budget.contextCharsSent + chars > this.ctxCharsLimit()) return false
    c.budget.contextCharsSent += chars
    return true
  }

  finishExec(sessionID: string, wallMs: number, reservedMs: number): void {
    const c = this.cache.get(sessionID)
    if (!c) return
    const safeWallMs = Number.isFinite(wallMs) && wallMs > 0 ? wallMs : 0
    const safeReservedMs = Number.isFinite(reservedMs) && reservedMs > 0 ? reservedMs : 0
    c.budget.wallMsUsed += safeWallMs
    c.budget.wallReservedMs = Math.max(0, c.budget.wallReservedMs - safeReservedMs)
    if (safeReservedMs > 0) c.activeExecCount = Math.max(0, c.activeExecCount - 1)
  }

  evictSession(sessionID: string): boolean {
    this.beginExecTails.delete(sessionID)
    return this.cache.delete(sessionID)
  }

  snapshot(sessionID: string): TurnSnapshot | null {
    const c = this.cache.get(sessionID)
    return c ? this.snap(c) : null
  }
}

export const turnGovernor = new TurnGovernor()
