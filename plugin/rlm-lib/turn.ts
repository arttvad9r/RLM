/**
 * Turn-level RLM governor (host side).
 *
 * One in-memory budget per root user turn. ToolContext.messageID is the pinned
 * OpenCode V2's assistant-message ID, so turn identity is resolved as the
 * nearest preceding user message for that exact assistant message rather than
 * from whichever user message happens to be latest when an async lookup ends.
 * Session cache entries are evicted only from the authoritative OpenCode
 * session.deleted lifecycle event; no TTL/LRU can reset active authority.
 */
import {
  MAX_CHILD_CALLS_PER_TURN,
  MAX_CONTEXT_CALLS_PER_TURN,
  MAX_CONTEXT_CHARS_PER_TURN,
  MAX_MEMORY_CALLS_PER_TURN,
  MAX_MEMORY_ENTRIES_PER_TURN,
  MAX_MEMORY_KEY_CHARS,
  MAX_MEMORY_TOTAL_CHARS_PER_TURN,
  MAX_MEMORY_VALUE_CHARS,
  MAX_RLM_EXECS_PER_TURN,
  MAX_RLM_WALL_MS_PER_TURN,
} from "./constants.ts"
import { RlmError } from "./errors.ts"
import type { RlmHost, RlmResolvedTurn } from "./host.ts"

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
  memoryCallCount: number
  memoryEntries: number
  memoryCharsStored: number
  wallMsUsed: number
  execsRemaining: number
  childCallsRemaining: number
  contextCallsRemaining: number
  contextCharsRemaining: number
  memoryCallsRemaining: number
  memoryEntriesRemaining: number
  memoryCharsRemaining: number
  wallMsRemaining: number
}

interface TurnBudget {
  execCount: number
  childCallCount: number
  contextCallCount: number
  contextCharsSent: number
  memoryCallCount: number
  wallMsUsed: number
  wallReservedMs: number
}

interface TurnMemoryEntry {
  serialized: string
  chars: number
}

interface SessionCache {
  lastUserMessageID: string | null
  lastMessageID: string | null
  lastMessageIndex: number
  activeExecCount: number
  budget: TurnBudget
  memory: Map<string, TurnMemoryEntry>
  memoryCharsStored: number
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
  return {
    execCount: 0,
    childCallCount: 0,
    contextCallCount: 0,
    contextCharsSent: 0,
    memoryCallCount: 0,
    wallMsUsed: 0,
    wallReservedMs: 0,
  }
}

function emptySessionCache(): SessionCache {
  return {
    lastUserMessageID: null,
    lastMessageID: null,
    lastMessageIndex: -1,
    activeExecCount: 0,
    budget: emptyBudget(),
    memory: new Map(),
    memoryCharsStored: 0,
  }
}

function validateMemoryKey(key: unknown): string {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new RlmError("INVALID_ARGUMENT", "memory key must be a non-empty string")
  }
  if (key.length > MAX_MEMORY_KEY_CHARS) {
    throw new RlmError("BUDGET_EXCEEDED", `memory key exceeds ${MAX_MEMORY_KEY_CHARS} characters`)
  }
  return key
}

function serializeMemoryValue(value: unknown): string {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new RlmError(
      "INVALID_ARGUMENT",
      `memory value must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (serialized === undefined) {
    throw new RlmError("INVALID_ARGUMENT", "memory value must be JSON-serializable")
  }
  if (serialized.length > MAX_MEMORY_VALUE_CHARS) {
    throw new RlmError("BUDGET_EXCEEDED", `memory value exceeds ${MAX_MEMORY_VALUE_CHARS} characters`)
  }
  return serialized
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
  private readonly invalidatedSessions = new Set<string>()
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

  private assertSessionValid(sessionID: string): void {
    if (!this.invalidatedSessions.has(sessionID)) return
    this.cache.delete(sessionID)
    throw new RlmError("RUNTIME_ERROR", "RLM session was deleted while resolving turn authority")
  }

  private async withBeginExecLock<T>(sessionID: string, task: () => Promise<T>): Promise<T> {
    const previous = this.beginExecTails.get(sessionID) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    this.beginExecTails.set(sessionID, tail)
    await previous
    try {
      this.assertSessionValid(sessionID)
      const result = await task()
      this.assertSessionValid(sessionID)
      return result
    } finally {
      release()
      if (this.invalidatedSessions.has(sessionID)) this.cache.delete(sessionID)
      if (this.beginExecTails.get(sessionID) === tail) {
        this.beginExecTails.delete(sessionID)
        this.invalidatedSessions.delete(sessionID)
      }
    }
  }

  private cacheForResolved(sessionID: string, resolved: RlmResolvedTurn): SessionCache {
    let c = this.cache.get(sessionID)
    if (!c) {
      c = emptySessionCache()
      this.cache.set(sessionID, c)
    }
    if (c.lastMessageID === resolved.boundaryId && c.lastUserMessageID === resolved.turnId) return c

    if (resolved.order < c.lastMessageIndex) {
      throw new RlmError(
        "RUNTIME_ERROR",
        `refusing stale RLM tool call from boundary ${resolved.boundaryId}; a newer boundary is already authoritative`,
      )
    }
    if (resolved.order === c.lastMessageIndex && c.lastMessageID !== null && c.lastMessageID !== resolved.boundaryId) {
      throw new RlmError("RUNTIME_ERROR", "conflicting host boundary identity at the current RLM turn boundary")
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
      c.memory.clear()
      c.memoryCharsStored = 0
    }
    c.lastMessageID = resolved.boundaryId
    c.lastMessageIndex = resolved.order
    return c
  }

  private async cacheFor(
    client: SessionMessagesClient,
    sessionID: string,
    directory: string,
    messageID: string,
  ): Promise<SessionCache> {
    if (!this.cache.has(sessionID)) {
      this.cache.set(sessionID, emptySessionCache())
    }
    const resolved = await userTurnForAssistantMessage(client, sessionID, directory, messageID)
    return this.cacheForResolved(sessionID, {
      turnId: resolved.turnId,
      boundaryId: messageID,
      order: resolved.messageIndex,
    })
  }

  private reserveExecFromCache(
    c: SessionCache,
    requestedWallMs: number,
  ): { allowed: boolean; reason?: string; snapshot: TurnSnapshot; reservedWallMs: number } {
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
  }

  private cacheForTurn(sessionID: string, turnId: string): SessionCache | undefined {
    const c = this.cache.get(sessionID)
    if (!c || c.lastUserMessageID !== turnId) return undefined
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
      memoryCallCount: c.budget.memoryCallCount,
      memoryEntries: c.memory.size,
      memoryCharsStored: c.memoryCharsStored,
      wallMsUsed: c.budget.wallMsUsed,
      execsRemaining: Math.max(0, this.execsLimit() - c.budget.execCount),
      childCallsRemaining: Math.max(0, MAX_CHILD_CALLS_PER_TURN - c.budget.childCallCount),
      contextCallsRemaining: Math.max(0, this.ctxCallsLimit() - c.budget.contextCallCount),
      contextCharsRemaining: Math.max(0, this.ctxCharsLimit() - c.budget.contextCharsSent),
      memoryCallsRemaining: Math.max(0, MAX_MEMORY_CALLS_PER_TURN - c.budget.memoryCallCount),
      memoryEntriesRemaining: Math.max(0, MAX_MEMORY_ENTRIES_PER_TURN - c.memory.size),
      memoryCharsRemaining: Math.max(0, MAX_MEMORY_TOTAL_CHARS_PER_TURN - c.memoryCharsStored),
      wallMsRemaining: this.wallAvailable(c),
    }
  }

  /** Compatibility seam for tests/legacy adapters that expose message history directly. */
  async beginExec(
    client: SessionMessagesClient,
    sessionID: string,
    directory: string,
    messageID: string,
    requestedWallMs = 0,
  ): Promise<{ allowed: boolean; reason?: string; snapshot: TurnSnapshot; reservedWallMs: number }> {
    return this.withBeginExecLock(sessionID, async () => {
      const c = await this.cacheFor(client, sessionID, directory, messageID)
      return this.reserveExecFromCache(c, requestedWallMs)
    })
  }

  /** Host-neutral entry point used by the RLM runtime. */
  async beginHostExec(
    host: Pick<RlmHost, "resolveTurn">,
    sessionID: string,
    directory: string,
    boundaryID: string,
    requestedWallMs = 0,
  ): Promise<{ allowed: boolean; reason?: string; snapshot: TurnSnapshot; reservedWallMs: number; rootModel?: string }> {
    return this.withBeginExecLock(sessionID, async () => {
      const resolved = await host.resolveTurn({ sessionID, directory, boundaryID })
      const c = this.cacheForResolved(sessionID, resolved)
      return { ...this.reserveExecFromCache(c, requestedWallMs), ...(resolved.rootModel ? { rootModel: resolved.rootModel } : {}) }
    })
  }

  /** Manual/test seam for the currently active turn. */
  reserveExec(sessionID: string, ms: number): void {
    const c = this.cache.get(sessionID)
    if (!c) return
    const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0
    c.budget.wallReservedMs += safeMs
  }

  /** True only while the captured execution turn remains session-authoritative. */
  isCurrentTurn(sessionID: string, turnId: string): boolean {
    return this.cacheForTurn(sessionID, turnId) !== undefined
  }

  childAllowedForTurn(sessionID: string, turnId: string): boolean {
    const c = this.cacheForTurn(sessionID, turnId)
    return Boolean(c && c.budget.childCallCount < MAX_CHILD_CALLS_PER_TURN)
  }

  registerChildStartForTurn(sessionID: string, turnId: string): boolean {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c || c.budget.childCallCount >= MAX_CHILD_CALLS_PER_TURN) return false
    c.budget.childCallCount++
    return true
  }

  beginContextCallForTurn(sessionID: string, turnId: string): boolean {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c) return false
    c.budget.contextCallCount++
    return c.budget.contextCallCount <= this.ctxCallsLimit()
  }

  addContextCharsForTurn(sessionID: string, turnId: string, chars: number): boolean {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c || !Number.isSafeInteger(chars) || chars < 0) return false
    if (c.budget.contextCharsSent + chars > this.ctxCharsLimit()) return false
    c.budget.contextCharsSent += chars
    return true
  }

  beginMemoryCallForTurn(sessionID: string, turnId: string): boolean {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c) return false
    c.budget.memoryCallCount++
    return c.budget.memoryCallCount <= MAX_MEMORY_CALLS_PER_TURN
  }

  memoryGetForTurn(sessionID: string, turnId: string, keyValue: unknown): { found: boolean; value?: unknown } {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c) throw new RlmError("RUNTIME_ERROR", "working memory turn is no longer current")
    const key = validateMemoryKey(keyValue)
    const entry = c.memory.get(key)
    if (!entry) return { found: false }
    return { found: true, value: JSON.parse(entry.serialized) }
  }

  memorySetForTurn(sessionID: string, turnId: string, keyValue: unknown, value: unknown): void {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c) throw new RlmError("RUNTIME_ERROR", "working memory turn is no longer current")
    const key = validateMemoryKey(keyValue)
    const serialized = serializeMemoryValue(value)
    const previous = c.memory.get(key)
    if (!previous && c.memory.size >= MAX_MEMORY_ENTRIES_PER_TURN) {
      throw new RlmError("BUDGET_EXCEEDED", `working memory exceeds ${MAX_MEMORY_ENTRIES_PER_TURN} entries per turn`)
    }
    const chars = key.length + serialized.length
    const projected = c.memoryCharsStored - (previous?.chars ?? 0) + chars
    if (projected > MAX_MEMORY_TOTAL_CHARS_PER_TURN) {
      throw new RlmError("BUDGET_EXCEEDED", `working memory exceeds ${MAX_MEMORY_TOTAL_CHARS_PER_TURN} characters per turn`)
    }
    c.memory.set(key, { serialized, chars })
    c.memoryCharsStored = projected
  }

  memoryDeleteForTurn(sessionID: string, turnId: string, keyValue: unknown): boolean {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c) throw new RlmError("RUNTIME_ERROR", "working memory turn is no longer current")
    const key = validateMemoryKey(keyValue)
    const previous = c.memory.get(key)
    if (!previous) return false
    c.memory.delete(key)
    c.memoryCharsStored = Math.max(0, c.memoryCharsStored - previous.chars)
    return true
  }

  memoryKeysForTurn(sessionID: string, turnId: string): string[] {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c) throw new RlmError("RUNTIME_ERROR", "working memory turn is no longer current")
    return [...c.memory.keys()].sort()
  }

  finishExecForTurn(sessionID: string, turnId: string, wallMs: number, reservedMs: number): boolean {
    const c = this.cacheForTurn(sessionID, turnId)
    if (!c) return false
    const safeWallMs = Number.isFinite(wallMs) && wallMs > 0 ? wallMs : 0
    const safeReservedMs = Number.isFinite(reservedMs) && reservedMs > 0 ? reservedMs : 0
    c.budget.wallMsUsed += safeWallMs
    c.budget.wallReservedMs = Math.max(0, c.budget.wallReservedMs - safeReservedMs)
    if (safeReservedMs > 0) c.activeExecCount = Math.max(0, c.activeExecCount - 1)
    return true
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
    if (this.beginExecTails.has(sessionID)) this.invalidatedSessions.add(sessionID)
    else this.invalidatedSessions.delete(sessionID)
    return this.cache.delete(sessionID)
  }

  snapshot(sessionID: string): TurnSnapshot | null {
    const c = this.cache.get(sessionID)
    return c ? this.snap(c) : null
  }
}

export const turnGovernor = new TurnGovernor()
