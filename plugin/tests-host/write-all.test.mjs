import assert from "node:assert/strict"
import test from "node:test"

import { RlmError } from "../rlm-lib/errors.ts"
import { writeAllSync } from "../rlm-runner/write-all.ts"

test("runner writeAllSync retries partial writes until every byte is emitted", () => {
  const chunks = []
  let calls = 0
  const writer = {
    writeSync(data) {
      calls++
      const written = Math.min(3, data.length)
      chunks.push(Buffer.from(data.subarray(0, written)))
      return written
    },
  }
  const input = new TextEncoder().encode("0123456789abcdef")
  writeAllSync(writer, input)
  assert.equal(Buffer.concat(chunks).toString(), "0123456789abcdef")
  assert.equal(calls, 6)
})

test("runner writeAllSync fails closed when a sync writer makes no progress", () => {
  assert.throws(
    () => writeAllSync({ writeSync: () => 0 }, new Uint8Array([1])),
    (error) => error instanceof RlmError
      && error.code === "RUNTIME_ERROR"
      && /invalid progress/.test(error.message),
  )
})

test("runner writeAllSync rejects impossible byte counts", () => {
  assert.throws(
    () => writeAllSync({ writeSync: (data) => data.length + 1 }, new Uint8Array([1, 2])),
    /invalid progress/,
  )
})
