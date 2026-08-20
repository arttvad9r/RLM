import assert from "node:assert/strict"
import test from "node:test"

import { RlmError, toErrorInfo } from "../rlm-lib/errors.ts"

test("toErrorInfo normalizes unprintable thrown values without throwing", () => {
  const unprintable = Object.create(null)
  const info = toErrorInfo(unprintable)
  assert.equal(info.code, "RUNTIME_ERROR")
  assert.equal(info.message, "unprintable runtime error")
})

test("toErrorInfo bounds untrusted runtime error messages", () => {
  const info = toErrorInfo(new Error("x".repeat(20_000)))
  assert.equal(info.code, "RUNTIME_ERROR")
  assert.ok(info.message.length <= 8193)
  assert.match(info.message, /…$/)
})

test("RlmError retains its stable code while bounding its envelope", () => {
  const info = toErrorInfo(new RlmError("CHILD_FAILED", "x".repeat(20_000)))
  assert.equal(info.code, "CHILD_FAILED")
  assert.ok(info.message.length <= 8193)
  assert.match(info.message, /…$/)
})
