/**
 * Turn-level RLM governor (host side).
 *
 * One in-memory budget per root user turn. ToolContext.messageID is the pinned
 * OpenCode SDK's assistant-message ID, so turn identity is resolved as the
 * nearest preceding user message for that exact assistant message rather than
 * from whichever user message happens to be latest when an async lookup ends.
 * Active executions retain their captured turn state across a later user-turn
 * transition so child/context/wall accounting cannot leak into the new turn.
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

interface TurnState {
  turnId: string
  budget: TurnBudget
  activeExecCount: number
}

interface SessionCache {
  lastMessageID: string | null
  lastMessageIndex: number
  current: TurnState | null
  retired: Map<string, TurnState>
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

  private session(sessionID: string): SessionCache {
    let c = this.cache.get(sessionID)
    if (!c) {
      c = { lastMessageID: null, lastMessageIndex: -1, current: null, retired: new Map() }
      this.cache.set(sessionID, c)
    }
    return c
  }

  private async turnFor(
    client: SessionMessagesClient,
    sessionID: string,
    directory: string,
    messageID: string,
  ): Promise<TurnState> {
    const c = this.session(sessionID)
    if (c.lastMessageID === messageID && c.current !== null) return c.current

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

    if (c.current?.turnId !== resolved.turnId) {
      if (c.current && c.current.activeExecCount > 0) {
        c.retired.set(c.current.turnId, c.current)
      }
      c.current = { turnId: resolved.turnId, budget: emptyBudget(), activeExecCount: 0 }
    }
    c.lastMessageID = messageID
    c.lastMessageIndex = resolved.messageIndex
    return c.current
  }

  private stateForTurn(sessionID: string, turnId: string): TurnState | undefined {
    const c = this.cache.get(sessionID)
    if (!c) return undefined
    if (c.current?.turnId === turnId) return c.current
    return c.retired.get(turnId)
  }

  private wallAvailable(turn: TurnState): number {
    return Math.max(0, this.wallLimitMs - turn.budget.wallMsUsed - turn.budget.wallReservedMs)
  }

  private snap(turn: TurnState): TurnSnapshot {
    return {
      turnId: turn.turnId,
      execCount: turn.budget.execCount,
      childCallCount: turn.budget.childCallCount,
      contextCallCount: turn.budget.contextCallCount,
      contextCharsSent: turn.budget.contextCharsSent,
      wallMsUsed: turn.budget.wallMsUsed,
      execsRemaining: Math.max(0, this.execsLimit() - turn.budget.execCount),
      childCallsRemaining: Math.max(0, MAX_CHILD_CALLS_PER_TURN - turn.budget.childCallCount),
      contextCallsRemaining: Math.max(0, this.ctxCallsLimit() - turn.budget.contextCallCount),
      contextCharsRemaining: Math.max(0, this.ctxCharsLimit() - turn.budget.contextCharsSent),
      wallMsRemaining: this.wallAvailable(turn),
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
      const turn = await this.turnFor(client, sessionID, directory, messageID)
      const snap = this.snap(turn)
      if (turn.budget.execCount >= this.execsLimit()) {
        return { allowed: false, reason: `maximum ${this.execsLimit()} rlm_exec per user turn reached`, snapshot: snap, reservedWallMs: 0 }
      }
      const available = this.wallAvailable(turn)
      if (available <= 0) {
        return { allowed: false, reason: "rlm_exec wall budget for this user turn is exhausted", snapshot: snap, reservedWallMs: 0 }
      }
      const safeRequest = Number.isFinite(requestedWallMs) && requestedWallMs > 0 ? requestedWallMs : 0
      const reservedWallMs = Math.min(safeRequest, available)
      turn.budget.execCount++
      turn.budget.wallReservedMs += reservedWallMs
      turn.activeExecCount++
      return { allowed: true, snapshot: this.snap(turn), reservedWallMs }
    })
  }

  /** Manual/test seam for the currently authoritative turn. */
  reserveExec(sessionID: string, ms: number): void {
    const turn = this.cache.get(sessionID)?.current
    if (!turn) return
    const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0
    turn.budget.wallReservedMs += safeMs
  }

  /** Current-turn seams retained for governor unit tests and administrative inspection. */
  childAllowed(sessionID: string): boolean {
    const turn = this.cache.get(sessionID)?.current
    return Boolean(turn && turn.budget.childCallCount < MAX_CHILD_CALLS_PER_TURN)
  }

  registerChildStart(sessionID: string): void {
    const turn = this.cache.get(sessionID)?.current
    if (turn) turn.budget.childCallCount++
  }

  beginContextCall(sessionID: string): boolean {
    const turn = this.cache.get(sessionID)?.current
    if (!turn) return false
    turn.budget.contextCallCount++
    return turn.budget.contextCallCount <= this.ctxCallsLimit()
  }

  addContextChars(sessionID: string, chars: number): boolean {
    const turn = this.cache.get(sessionID)?.current
    if (!turn) return false
    if (!Number.isSafeInteger(chars) || chars < 0) return false
    if (turn.budget.contextCharsSent + chars > this.ctxCharsLimit()) return false
    turn.budget.contextCharsSent += chars
    return true
  }

  finishExec(sessionID: string, wallMs: number, reservedMs: number): void {
    const turn = this.cache.get(sessionID)?.current
    if (!turn) return
    const safeWallMs = Number.isFinite(wallMs) && wallMs > 0 ? wallMs : 0
    const safeReservedMs = Number.isFinite(reservedMs) && reservedMs > 0 ? reservedMs : 0
    turn.budget.wallMsUsed += safeWallMs
    turn.budget.wallReservedMs = Math.max(0, turn.budget.wallReservedMs - safeReservedMs)
    turn.activeExecCount = Math.max(0, turn.activeExecCount - 1)
  }

  /** Production exec path: every mutation is bound to the turn captured at beginExec. */
  beginChildCallForTurn(sessionID: string, turnId: string): boolean {
    const turn = this.stateForTurn(sessionID, turnId)
    if (!turn || turn.budget.childCallCount >= MAX_CHILD_CALLS_PER_TURN) return false
    turn.budget.childCallCount++
    return true
  }

  beginContextCallForTurn(sessionID: string, turnId: string): boolean {
    const turn = this.stateForTurn(sessionID, turnId)
    if (!turn) return false
    turn.budget.contextCallCount++
    return turn.budget.contextCallCount <= this.ctxCallsLimit()
  }

  addContextCharsForTurn(sessionID: string, turnId: string, chars: number): boolean {
    const turn = this.stateForTurn(sessionID, turnId)
    if (!turn) return false
    if (!Number.isSafeInteger(chars) || chars < 0) return false
    if (turn.budget.contextCharsSent + chars > this.ctxCharsLimit()) return false
    turn.budget.contextCharsSent += chars
    return true
  }

  finishExecForTurn(sessionID: string, turnId: string, wallMs: number, reservedMs: number): TurnSnapshot | null {
    const c = this.cache.get(sessionID)
    const turn = this.stateForTurn(sessionID, turnId)
    if (!c || !turn) return null
    const safeWallMs = Number.isFinite(wallMs) && wallMs > 0 ? wallMs : 0
    const safeReservedMs = Number.isFinite(reservedMs) && reservedMs > 0 ? reservedMs : 0
    turn.budget.wallMsUsed += safeWallMs
    turn.budget.wallReservedMs = Math.max(0, turn.budget.wallReservedMs - safeReservedMs)
    turn.activeExecCount = Math.max(0, turn.activeExecCount - 1)
    const snapshot = this.snap(turn)
    if (c.current !== turn && turn.activeExecCount === 0) c.retired.delete(turn.turnId)
    return snapshot
  }

  snapshotForTurn(sessionID: string, turnId: string): TurnSnapshot | null {
    const turn = this.stateForTurn(sessionID, turnId)
    return turn ? this.snap(turn) : null
  }

  evictSession(sessionID: string): boolean {
    this.beginExecTails.delete(sessionID)
    return this.cache.delete(sessionID)
  }

  snapshot(sessionID: string): TurnSnapshot | null {
    const turn = this.cache.get(sessionID)?.current
    return turn ? this.snap(turn) : null
  }
}

export const turnGovernor = new TurnGovernor()
