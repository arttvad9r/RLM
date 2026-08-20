import type { Logger, LogLevel } from "./types.ts"

/** Diagnostic logging must never participate in the tool lifecycle. */
export function logBestEffort(
  log: Logger,
  level: LogLevel,
  message: string,
  extra: Record<string, unknown> = {},
): void {
  try {
    void Promise.resolve(log(level, message, extra)).catch(() => {})
  } catch {
    // Logging is explicitly non-authoritative and non-blocking.
  }
}
