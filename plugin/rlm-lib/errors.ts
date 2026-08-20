/**
 * RlmError — runtime error with a stable machine-readable code.
 * Shared by host and sandbox runner.
 */
import type { ErrorCode, RlmErrorInfo } from "./types.ts"

const MAX_ERROR_MESSAGE_CHARS = 8192

function boundedMessage(message: string): string {
  return message.length <= MAX_ERROR_MESSAGE_CHARS
    ? message
    : `${message.slice(0, MAX_ERROR_MESSAGE_CHARS)}…`
}

function safeUnknownMessage(value: unknown): string {
  try {
    if (value instanceof Error && typeof value.message === "string" && value.message.length > 0) {
      return boundedMessage(value.message)
    }
  } catch {
    // A proxy/hostile Error-like value may throw during property access.
  }
  try {
    return boundedMessage(String(value))
  } catch {
    return "unprintable runtime error"
  }
}

export class RlmError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = "RlmError"
    this.code = code
  }

  toInfo(): RlmErrorInfo {
    return { code: this.code, message: boundedMessage(this.message) }
  }
}

/** Normalize any thrown value to a stable, bounded error envelope. */
export function toErrorInfo(e: unknown): RlmErrorInfo {
  if (e instanceof RlmError) return e.toInfo()
  return { code: "RUNTIME_ERROR", message: safeUnknownMessage(e) }
}
