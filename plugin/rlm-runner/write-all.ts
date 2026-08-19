import { RlmError } from "../rlm-lib/errors.ts"

export interface SyncWriter {
  writeSync(data: Uint8Array): number
}

/** Synchronously emit an entire buffer; low-level Deno writes may be partial. */
export function writeAllSync(writer: SyncWriter, data: Uint8Array): void {
  let offset = 0
  while (offset < data.length) {
    const remaining = data.subarray(offset)
    const written = writer.writeSync(remaining)
    if (!Number.isSafeInteger(written) || written <= 0 || written > remaining.length) {
      throw new RlmError("RUNTIME_ERROR", `runner stream write made invalid progress: ${String(written)}`)
    }
    offset += written
  }
}
