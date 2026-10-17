import {
  MAX_CHILD_CALLS_PER_TURN,
  MAX_CONTEXT_CALLS,
  MAX_CONTEXT_CALLS_PER_TURN,
  MAX_CONTEXT_CHARS_PER_TURN,
  MAX_MEMORY_CALLS_PER_EXEC,
  MAX_MEMORY_CALLS_PER_TURN,
  MAX_RLM_EXECS_PER_TURN,
  MAX_RLM_WALL_MS_PER_TURN,
  MAX_SUBCALLS_CONCURRENT,
  MAX_SUBCALLS_TOTAL,
  MAX_TOTAL_CONTEXT_CHARS,
  PROTOCOL_VERSION,
  TELEMETRY_SCHEMA_VERSION,
} from "./constants.ts"
import type { TurnSnapshot } from "./turn.ts"
import type { ChildInvocationUsage } from "./types.ts"

export interface RlmTelemetryV1 {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION
  protocolVersion: typeof PROTOCOL_VERSION
  runId: string
  adapter: string
  turnId: string
  rootModel?: string
  durationMs: number
  operation: { kind: "exec" } | {
    kind: "map"
    fanout: number
    output: string
    partition: string
    failureMode: string
    fileCount?: number
    partitionCount?: number
    failedPartitions?: number
    formatViolations?: number
    outputLimitViolations?: number
    candidateSourceChars?: number
    reducerCalls?: number
    reductionLevels?: number
    reducedResultChars?: number
  } | {
    kind: "verify"
    fanout: number
    partition: string
    failureMode: string
    candidateCount: number
    keptCount: number
    removedCount: number
    partitionCount: number
    failedPartitions: number
    formatViolations: number
    outputLimitViolations: number
    provisionalRemovedCount: number
    confirmationPartitionCount: number
  }
  child: {
    calls: number
    successes: number
    failures: number
    maxConcurrencyObserved: number
    models: string[]
    modelStrategy: string
    cost: number
    tokensInput: number
    tokensOutput: number
    tokensCacheRead: number
    tokensCacheWrite: number
    invocations: ChildInvocationUsage[]
  }
  context: { calls: number; charsSent: number }
  memory: { calls: number }
  result: { chars: number }
  termination: {
    status: "ok"
    timedOut: boolean
    exitCode: number | null
    stderrTruncated: boolean
    ignoredStdoutLines: number
    turnSuperseded: boolean
  }
  limits: {
    exec: {
      childCalls: number
      childConcurrency: number
      contextCalls: number
      contextChars: number
      memoryCalls: number
    }
    turn: {
      execs: number
      childCalls: number
      contextCalls: number
      contextChars: number
      memoryCalls: number
      wallMs: number
    }
  }
  turn?: TurnSnapshot
}

export function createRlmTelemetryV1(input: Omit<RlmTelemetryV1, "schemaVersion" | "protocolVersion" | "limits">): RlmTelemetryV1 {
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    ...input,
    limits: {
      exec: {
        childCalls: MAX_SUBCALLS_TOTAL,
        childConcurrency: MAX_SUBCALLS_CONCURRENT,
        contextCalls: MAX_CONTEXT_CALLS,
        contextChars: MAX_TOTAL_CONTEXT_CHARS,
        memoryCalls: MAX_MEMORY_CALLS_PER_EXEC,
      },
      turn: {
        execs: MAX_RLM_EXECS_PER_TURN,
        childCalls: MAX_CHILD_CALLS_PER_TURN,
        contextCalls: MAX_CONTEXT_CALLS_PER_TURN,
        contextChars: MAX_CONTEXT_CHARS_PER_TURN,
        memoryCalls: MAX_MEMORY_CALLS_PER_TURN,
        wallMs: MAX_RLM_WALL_MS_PER_TURN,
      },
    },
  }
}
