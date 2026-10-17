/**
 * RLM protocol v1 types, stable error codes, and the single per-run state.
 * Shared by host and sandbox runner (dependency-free).
 */
import { PROTOCOL_VERSION } from "./constants.ts"

// ---------------------------------------------------------------------------
// Stable error codes
// ---------------------------------------------------------------------------
export type ErrorCode =
  | "BUDGET_EXCEEDED"
  | "TIMEOUT"
  | "CONTEXT_DENIED"
  | "CHILD_FAILED"
  | "PROTOCOL_ERROR"
  | "RUNTIME_ERROR"
  | "READ_FAILED"
  | "INVALID_ARGUMENT"

export interface RlmErrorInfo {
  code: ErrorCode
  message: string
}

// ---------------------------------------------------------------------------
// Protocol v1 messages (JSONL over stdin/stdout between host and runner)
// ---------------------------------------------------------------------------
export type ContextOperation = "read" | "readMany" | "grep" | "files" | "glob"
export type MemoryOperation = "get" | "set" | "delete" | "keys"

// host -> sandbox
export interface CodeMessage {
  v: typeof PROTOCOL_VERSION
  type: "code"
  code: string
}
export interface LlmResultMessage {
  v: typeof PROTOCOL_VERSION
  type: "llm_result"
  id: string
  ok: boolean
  text?: string
  error?: RlmErrorInfo
}
export interface ContextResultMessage {
  v: typeof PROTOCOL_VERSION
  type: "context_result"
  id: string
  ok: boolean
  value?: unknown
  error?: RlmErrorInfo
}
export interface MemoryResultMessage {
  v: typeof PROTOCOL_VERSION
  type: "memory_result"
  id: string
  ok: boolean
  value?: unknown
  error?: RlmErrorInfo
}

// sandbox -> host
export interface LlmRequestMessage {
  v: typeof PROTOCOL_VERSION
  type: "llm"
  id: string
  prompt: string
}
export interface ContextRequestMessage {
  v: typeof PROTOCOL_VERSION
  type: "context"
  id: string
  operation: ContextOperation
  path?: string
  paths?: string[]
  pattern?: string
  query?: string
}
export interface MemoryRequestMessage {
  v: typeof PROTOCOL_VERSION
  type: "memory"
  id: string
  operation: MemoryOperation
  key?: string
  value?: unknown
}
export interface ResultMessage {
  v: typeof PROTOCOL_VERSION
  type: "result"
  value: unknown
}
export interface ErrorMessage {
  v: typeof PROTOCOL_VERSION
  type: "error"
  error: RlmErrorInfo
}

export type HostToSandboxMessage = CodeMessage | LlmResultMessage | ContextResultMessage | MemoryResultMessage
export type SandboxToHostMessage = LlmRequestMessage | ContextRequestMessage | MemoryRequestMessage | ResultMessage | ErrorMessage

// ---------------------------------------------------------------------------
// Model-facing (simplified) result shapes carried in context_result `value`
// ---------------------------------------------------------------------------
export interface ReadManyItem {
  path: string
  content?: string
  error?: RlmErrorInfo
}
export interface GrepMatch {
  path: string
  line: number
  text: string
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
export type LogLevel = "debug" | "info" | "warn" | "error"
export type Logger = (
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
) => Promise<void>

// ---------------------------------------------------------------------------
// RlmRunState — single state object for one rlm_exec run (host side)
// ---------------------------------------------------------------------------
export interface ActiveChild {
  sessionID: string
  abort: () => void
}

export interface ChildInvocationUsage {
  index: number
  status: "ok" | "error"
  model?: string
  durationMs: number
  responseChars: number
  cost: number
  tokensInput: number
  tokensOutput: number
  tokensCacheRead: number
  tokensCacheWrite: number
  errorCode?: string
}

function genRunId(): string {
  const c = (globalThis as Record<string, unknown>).crypto as { randomUUID?: () => string } | undefined
  const uuid = c?.randomUUID?.()
  const raw = uuid ?? `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  return `rlm_${raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`
}

export class RlmRunState {
  readonly runId: string
  readonly protocolVersion: typeof PROTOCOL_VERSION = PROTOCOL_VERSION
  readonly workspaceRoot: string
  readonly broadWorkspaceRoot: boolean
  readonly hostConfigFallbackFile?: string
  readonly startedAt: number
  readonly deadlineAt: number
  readonly abort = new AbortController()
  readonly activeChildSessions = new Map<string, ActiveChild>()
  readonly childSessionIDs: string[] = []
  readonly childModels: string[] = []
  readonly childInvocations: ChildInvocationUsage[] = []

  /** Internal host cache: canonical parent dir -> listing promise (names). */
  readonly dirListings = new Map<string, Promise<Set<string>>>()

  childCallCount = 0
  childSuccessCount = 0
  childFailureCount = 0
  contextCallCount = 0
  contextCharsSent = 0
  memoryCallCount = 0

  // child token/cost aggregation (from prompt info when available)
  childCostSum = 0
  childTokensInputSum = 0
  childTokensOutputSum = 0
  childTokensCacheReadSum = 0
  childTokensCacheWriteSum = 0

  timedOut = false
  exitCode: number | null = null

  constructor(opts: { workspaceRoot: string; broadWorkspaceRoot: boolean; timeoutMs: number; hostConfigFallbackFile?: string }) {
    this.runId = genRunId()
    this.workspaceRoot = opts.workspaceRoot
    this.broadWorkspaceRoot = opts.broadWorkspaceRoot
    this.hostConfigFallbackFile = opts.hostConfigFallbackFile
    this.startedAt = Date.now()
    this.deadlineAt = this.startedAt + opts.timeoutMs
  }

  /** Abort children and the sandbox; safe to call multiple times. */
  cleanup(): void {
    this.abort.abort()
    for (const child of this.activeChildSessions.values()) {
      try {
        child.abort()
      } catch {
        // ignore
      }
    }
    this.activeChildSessions.clear()
  }
}
