/**
 * RLM limits and protocol constants. Shared by the host plugin and the Deno
 * sandbox runner. This module must stay free of Node/Deno-specific globals so
 * both runtimes can import it.
 */
export const PROTOCOL_VERSION = 1 as const

// llm subcalls
export const MAX_SUBCALLS_TOTAL = 4
export const MAX_SUBCALLS_CONCURRENT = 4
export const MAX_PROMPT_CHARS = 32 * 1024
export const MAX_CHILD_RESULT_CHARS = 128 * 1024
export const MAX_CHILD_TOOL_IDS = 1024
export const MAX_CHILD_TOOL_ID_CHARS = 256

// context operations
export const MAX_CONTEXT_CALLS = 32
export const MAX_CONTEXT_CALLS_CONCURRENT = 4
export const MAX_READ_MANY_FILES = 64
export const MAX_READ_CHARS = 128 * 1024
export const MAX_CONTEXT_PATH_CHARS = 4096
export const MAX_GREP_PATTERN_CHARS = 8 * 1024
export const MAX_FILES_QUERY_CHARS = 4096
export const MAX_GREP_MATCHES = 200
export const MAX_GLOB_PATHS = 4096
export const MAX_GLOB_DIRS = 2000
export const MAX_CONTEXT_ENTRIES_SCANNED = 16_384
export const MAX_TOTAL_CONTEXT_CHARS = 1_048_576 // 1 MiB — do not weaken

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
export const MAX_IGNORED_STDOUT_LINES = 64
export const MAX_IGNORED_STDOUT_CHARS = 64 * 1024

// per-user-turn governor (host side, reset on each new user message)
// execs is a circuit breaker, not the working budget: cheap probes must not
// block real analysis. The working budgets are child/context/wall.
export const MAX_RLM_EXECS_PER_TURN = 12
export const MAX_CHILD_CALLS_PER_TURN = 8
export const MAX_CONTEXT_CALLS_PER_TURN = 96
export const MAX_CONTEXT_CHARS_PER_TURN = 2 * 1024 * 1024
export const MAX_RLM_WALL_MS_PER_TURN = 180_000
