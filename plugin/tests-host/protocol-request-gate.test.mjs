import assert from "node:assert/strict"
import test from "node:test"

import {
  MAX_PROTOCOL_REQUEST_ID_CHARS,
  MAX_PROTOCOL_REQUESTS_TOTAL,
} from "../rlm-lib/constants.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { ProtocolRequestGate } from "../rlm-lib/protocol-request-gate.ts"

test("protocol request gate bounds retained ids and rejects reuse", () => {
  const gate = new ProtocolRequestGate()
  for (let index = 0; index < MAX_PROTOCOL_REQUESTS_TOTAL; index++) {
    gate.accept(`request-${index}`)
  }
  assert.equal(gate.count(), MAX_PROTOCOL_REQUESTS_TOTAL)

  assert.throws(
    () => gate.accept("request-0"),
    (error) => error instanceof RlmError && error.code === "PROTOCOL_ERROR" && /duplicate/.test(error.message),
  )
  assert.equal(gate.count(), MAX_PROTOCOL_REQUESTS_TOTAL)

  assert.throws(
    () => gate.accept("overflow"),
    (error) => error instanceof RlmError && error.code === "BUDGET_EXCEEDED" && /request limit/.test(error.message),
  )
  assert.equal(gate.count(), MAX_PROTOCOL_REQUESTS_TOTAL)
})

test("protocol request gate rejects empty and oversized ids before retention", () => {
  const gate = new ProtocolRequestGate()
  for (const id of ["", "x".repeat(MAX_PROTOCOL_REQUEST_ID_CHARS + 1)]) {
    assert.throws(
      () => gate.accept(id),
      (error) => error instanceof RlmError && error.code === "PROTOCOL_ERROR" && /request id/.test(error.message),
    )
  }
  assert.equal(gate.count(), 0)
  gate.accept("x".repeat(MAX_PROTOCOL_REQUEST_ID_CHARS))
  assert.equal(gate.count(), 1)
})
