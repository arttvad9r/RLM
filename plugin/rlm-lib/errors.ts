/**
 * RlmError — runtime error with a stable machine-readable code.
 * Shared by host and sandbox runner.
 */
import type { ErrorCode, RlmErrorInfo } from "./types.ts"

export class RlmError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = "RlmError"
    this.code = code
  }

  toInfo(): RlmErrorInfo {
    return { code: this.code, message: this.message }
  }
}

/** Normalize any thrown value to a stable error envelope. */
export function toErrorInfo(e: unknown): RlmErrorInfo {
  if (e instanceof RlmError) return e.toInfo()
  if (e instanceof Error) return { code: "RUNTIME_ERROR", message: e.message }
  return { code: "RUNTIME_ERROR", message: String(e) }
}
