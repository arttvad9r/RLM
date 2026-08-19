/**
 * Turn-level RLM governor (host side).
 *
 * One in-memory budget per root user turn, keyed by the id of the last user
 * message in the parent session. A new user message (new turn) resets the
 * budget; a new assistant step within the same turn reuses it. Session cache
 * entries are evicted only from the authoritative OpenCode session.deleted
 * lifecycle event; no TTL/LRU can reset authority for an active session.
 */
import {
  MAX_CHILD_CALLS_PER_TURN,
  MAX_CONTEXT_CALLS_PER_TURN,
  MAX_CONTEXT_CHARS_PER_TURN,
  MAX_RLM_EXECS_PER_TURN,
  MAX_RLM_WALL_MS_PER_TURN,
} from "./constants.ts"
import { RlmError } from "./errors.ts"

// Internal test-harness escape hatches: shorten large turn limits without
// changing production constants. Host process env only, never model-visible.
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

async function lastUserMessageID(
  client: SessionMessagesClient,
  sessionID: string,
  directory: string,
): Promise<string> {
  const res = await client.session.messages({ path: { id: sessionID }, query: { directory } })
  if (res.error) {
    throw new RlmError("RUNTIME_ERROR", "failed to resolve RLM user turn from parent session messages")
  }
  const messages = res.data ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i]?.info
    if (info?.role === "user" && typeof info.id === "string" && info.id.length > 0) return info.id
  }
  throw new RlmError("RUNTIME_ERROR", "failed to resolve RLM user turn: parent session has no user message id")
}

export class TurnGovernor {
  private readonly cache = new Map<string, SessionCache>()
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

  private async cacheFor(
    client: SessionMessagesClient,
    sessionID: string,
    directory: string,
    messageID: string,
  ): Promise<SessionCache> {
    let c = this.cache.get(sessionID)
    if (!c) {
      c = { lastUserMessageID: null, lastMessageID: null, budget: { execCount: 0, childCallCount: 0, contextCallCount: 0, contextCharsSent: 0, wallMsUsed: 0, wallReservedMs: 0 } }
      this.cache.set(sessionID, c)
    }
    if (c.lastMessageID === messageID && c.lastUserMessageID !== null) return c
    const turnId = await lastUserMessageID(client, sessionID, directory)
    if (c.lastUserMessageID !== turnId) {
      c.lastUserMessageID = turnId
      c.budget = { execCount: 0, childCallCount: 0, contextCallCount: 0, contextCharsSent: 0, wallMsUsed: 0, wallReservedMs: 0 }
    }
    c.lastMessageID = messageID
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

  /**
   * Resolve the current turn, count this exec and optionally reserve its wall
   * budget atomically before returning to the caller. This prevents concurrent
   * rlm_exec calls from both observing the same unreserved wall capacity.
   */
  async beginExec(
    client: SessionMessagesClient,
    sessionID: string,
    directory: string,
    messageID: string,
    requestedWallMs = 0,
  ): Promise<{ allowed: boolean; reason?: string; snapshot: TurnSnapshot; reservedWallMs: number }> {
    const c = await this.cacheFor(client, sessionID, directory, messageID)
    const snap = this.snap(c)
    if (c.budget.execCount >= this.execsLimit()) {
      return {
        allowed: false,
        reason: `maximum ${this.execsLimit()} rlm_exec per user turn reached`,
        snapshot: snap,
        reservedWallMs: 0,
      }
    }
    const available = this.wallAvailable(c)
    if (available <= 0) {
      return {
        allowed: false,
        reason: "rlm_exec wall budget for this user turn is exhausted",
        snapshot: snap,
        reservedWallMs: 0,
      }
    }

    const safeRequest = Number.isFinite(requestedWallMs) && requestedWallMs > 0 ? requestedWallMs : 0
    const reservedWallMs = Math.min(safeRequest, available)
    c.budget.execCount++
    c.budget.wallReservedMs += reservedWallMs
    return { allowed: true, snapshot: this.snap(c), reservedWallMs }
  }

  /** Manual/test seam. Production exec starts reserve atomically in beginExec. */
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
  }

  /**
   * Evict only after OpenCode has authoritatively deleted the root session.
   * Any already-running execution that races with deletion loses child/context
   * budget authority because all subsequent lookups fail closed.
   */
  evictSession(sessionID: string): boolean {
    return this.cache.delete(sessionID)
  }

  snapshot(sessionID: string): TurnSnapshot | null {
    const c = this.cache.get(sessionID)
    return c ? this.snap(c) : null
  }
}

export const turnGovernor = new TurnGovernor()
