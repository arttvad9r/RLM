import {
  MAX_PROTOCOL_REQUEST_ID_CHARS,
  MAX_PROTOCOL_REQUESTS_TOTAL,
} from "./constants.ts"
import { RlmError } from "./errors.ts"

/**
 * Bound per-exec protocol request identity state before any async work starts.
 * IDs remain remembered for the exec lifetime so reuse still fails closed.
 */
export class ProtocolRequestGate {
  readonly #seen = new Set<string>()

  accept(id: string): void {
    if (typeof id !== "string" || id.length < 1 || id.length > MAX_PROTOCOL_REQUEST_ID_CHARS) {
      throw new RlmError(
        "PROTOCOL_ERROR",
        `sandbox request id must contain 1-${MAX_PROTOCOL_REQUEST_ID_CHARS} characters`,
      )
    }
    if (this.#seen.has(id)) {
      throw new RlmError("PROTOCOL_ERROR", `duplicate sandbox request id: ${id}`)
    }
    if (this.#seen.size >= MAX_PROTOCOL_REQUESTS_TOTAL) {
      throw new RlmError(
        "BUDGET_EXCEEDED",
        `sandbox protocol request limit exceeded: maximum ${MAX_PROTOCOL_REQUESTS_TOTAL} requests per rlm_exec`,
      )
    }
    this.#seen.add(id)
  }

  count(): number {
    return this.#seen.size
  }
}
