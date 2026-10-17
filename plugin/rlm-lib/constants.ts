/**
 * RLM limits and protocol constants. Shared by the host plugin and the Deno
 * sandbox runner. This module must stay free of Node/Deno-specific globals so
 * both runtimes can import it.
 */
export const PROTOCOL_VERSION = 1 as const
export const TELEMETRY_SCHEMA_VERSION = 1 as const
export const STRUCTURED_RESULT_SCHEMA_VERSION = 1 as const

// llm subcalls
export const MAX_SUBCALLS_TOTAL = 16
export const MAX_SUBCALLS_CONCURRENT = 4
export const MAX_PROMPT_CHARS = 32 * 1024
export const MAX_CHILD_RESULT_CHARS = 128 * 1024

// context operations
export const MAX_CONTEXT_CALLS = 32
export const MAX_READ_MANY_FILES = 64
export const MAX_READ_CHARS = 128 * 1024
export const MAX_GREP_MATCHES = 200
export const MAX_GLOB_PATHS = 4096
export const MAX_GLOB_DIRS = 2000
export const MAX_CONTEXT_ENTRIES_SCANNED = 16_384
export const MAX_TOTAL_CONTEXT_CHARS = 1_048_576 // 1 MiB — do not weaken

// structured orchestration
export const MAX_STRUCTURED_QUERY_CHARS = 2 * 1024
export const MAX_STRUCTURED_INSTRUCTION_CHARS = 16 * 1024
export const MAX_STRUCTURED_SOURCE_FILES = 1024
export const MAX_STRUCTURED_ERROR_CHARS = 1024
export const MAX_STRUCTURED_TEXT_RESPONSE_CHARS = 32 * 1024
export const MAX_STRUCTURED_PATH_RESPONSE_CHARS = 16 * 1024
export const MAX_STRUCTURED_CANDIDATE_RESPONSE_CHARS = 16 * 1024
export const MAX_STRUCTURED_CANDIDATE_SOURCE_CHARS = 192 * 1024
export const MAX_STRUCTURED_VERIFY_CANDIDATES = 64
export const MAX_STRUCTURED_VERIFY_FANOUT = 8 // first pass + confirmation stay within the 16-call exec budget
export const MAX_STRUCTURED_VERIFY_PATH_CHARS = 1024
export const MAX_STRUCTURED_VERIFY_INPUT_CHARS = 32 * 1024

// turn-scoped working memory
export const MAX_MEMORY_CALLS_PER_EXEC = 64
export const MAX_MEMORY_CALLS_PER_TURN = 128
export const MAX_MEMORY_ENTRIES_PER_TURN = 128
export const MAX_MEMORY_KEY_CHARS = 128
export const MAX_MEMORY_VALUE_CHARS = 128 * 1024
export const MAX_MEMORY_TOTAL_CHARS_PER_TURN = 512 * 1024

// sandbox / protocol transport
export const MAX_CODE_CHARS = 100_000
export const MAX_EXEC_TIMEOUT_MS = 120_000
/** V8 old-space ceiling for the trusted Deno runner + generated Worker. This
 * bounds the primary JS heap but is not a replacement for an OS/cgroup RSS cap. */
export const MAX_DENO_OLD_SPACE_MB = 768
export const MAX_RESULT_CHARS = 256 * 1024
export const MAX_PROTOCOL_LINE_CHARS = 2 * 1024 * 1024
export const MAX_PROTOCOL_QUEUE_LINES = 128
export const MAX_PROTOCOL_REQUESTS_TOTAL = 128
export const MAX_PROTOCOL_REQUEST_ID_CHARS = 128
export const MAX_SANDBOX_STDERR_CHARS = 16 * 1024

// per-user-turn governor (host side, reset on each new user message)
// execs is a circuit breaker, not the working budget: cheap probes must not
// block real analysis. The working budgets are child/context/wall.
export const MAX_RLM_EXECS_PER_TURN = 12
export const MAX_CHILD_CALLS_PER_TURN = 32
export const MAX_CONTEXT_CALLS_PER_TURN = 96
export const MAX_CONTEXT_CHARS_PER_TURN = 2 * 1024 * 1024
export const MAX_RLM_WALL_MS_PER_TURN = 180_000
