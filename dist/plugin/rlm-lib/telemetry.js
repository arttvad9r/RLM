import { MAX_CHILD_CALLS_PER_TURN, MAX_CONTEXT_CALLS, MAX_CONTEXT_CALLS_PER_TURN, MAX_CONTEXT_CHARS_PER_TURN, MAX_MEMORY_CALLS_PER_EXEC, MAX_MEMORY_CALLS_PER_TURN, MAX_RLM_EXECS_PER_TURN, MAX_RLM_WALL_MS_PER_TURN, MAX_SUBCALLS_CONCURRENT, MAX_SUBCALLS_TOTAL, MAX_TOTAL_CONTEXT_CHARS, PROTOCOL_VERSION, TELEMETRY_SCHEMA_VERSION, } from "./constants.js";
export function createRlmTelemetryV1(input) {
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
    };
}
