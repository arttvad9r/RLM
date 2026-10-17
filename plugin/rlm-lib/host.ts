import type { Logger } from "./types.ts"

/** Host-neutral identity for the root user turn that owns one rlm_exec call. */
export interface RlmResolvedTurn {
  turnId: string
  /** Host-specific boundary identity used to distinguish stale tool calls. */
  boundaryId: string
  /** Monotonic host order when available. Equal values with different boundaries fail closed. */
  order: number
  /** Exact root model identity at this authoritative host boundary when available. */
  rootModel?: string
}

export interface ResolveRlmTurnInput {
  sessionID: string
  directory: string
  boundaryID: string
}

export interface ChildModelOverride {
  provider?: string
  model: string
  variant?: string
}

export interface ChildLlmInput {
  prompt: string
  parentSessionID: string
  /** User-turn identity captured when the parent rlm_exec began. */
  parentUserMessageID?: string
  /** Exact host boundary whose tool call started the parent rlm_exec. */
  parentAssistantMessageID?: string
  directory: string
  title?: string
  signal?: AbortSignal
  /** Optional trusted host-config override. Absent means inherit the root model exactly. */
  modelOverride?: ChildModelOverride
}

export interface ChildLlmResult {
  text: string
  childSessionID: string
  model: string
  deniedToolCount: number
  cost?: number
  tokensInput?: number
  tokensOutput?: number
  tokensCacheRead?: number
  tokensCacheWrite?: number
}

/**
 * Minimal host boundary required by the audited RLM core.
 *
 * OpenCode and Codex own their session/model/tool mechanics behind this seam;
 * sandbox execution, context I/O and turn budgets do not depend on either SDK.
 */
export interface RlmHost {
  /** Stable adapter identity for host-neutral telemetry when available. */
  readonly adapter?: string
  /** Root model identity when the adapter can expose it without another provider call. */
  readonly rootModel?: string
  /** Optional trusted fallback authority file used only for host migration compatibility. */
  readonly hostConfigFallbackFile?: string
  resolveTurn(input: ResolveRlmTurnInput): Promise<RlmResolvedTurn>
  callChild(input: ChildLlmInput, log: Logger): Promise<ChildLlmResult>
}
