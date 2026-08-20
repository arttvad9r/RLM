import assert from "node:assert/strict"
import test from "node:test"

import { RlmError } from "../rlm-lib/errors.ts"
import { parseHostMessage, parseSandboxFrame, parseSandboxMessage, validateErrorInfo } from "../rlm-lib/protocol.ts"

function rng(seed) {
  let state = seed >>> 0
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000)
}

const KEYS = ["v", "type", "id", "ok", "text", "code", "prompt", "operation", "path", "paths", "pattern", "query", "value", "error", "message", "extra", "__proto__"]
const STRINGS = ["", "x", "llm", "context", "result", "error", "code", "llm_result", "context_result", "read", "readMany", "grep", "files", "glob", "PROTOCOL_ERROR", "UNKNOWN", "../x", "🙂"]

function randomValue(next, depth = 0) {
  const pick = Math.floor(next() * (depth >= 3 ? 5 : 7))
  if (pick === 0) return null
  if (pick === 1) return next() < 0.5
  if (pick === 2) return Math.floor(next() * 5) - 2
  if (pick === 3) return STRINGS[Math.floor(next() * STRINGS.length)]
  if (pick === 4) return undefined
  if (pick === 5) return Array.from({ length: Math.floor(next() * 4) }, () => randomValue(next, depth + 1))
  const result = {}
  const count = Math.floor(next() * 8)
  for (let index = 0; index < count; index++) {
    const key = KEYS[Math.floor(next() * KEYS.length)]
    result[key] = randomValue(next, depth + 1)
  }
  return result
}

function assertStableParser(parser, line) {
  try {
    parser(line)
  } catch (error) {
    assert.ok(error instanceof RlmError, `raw error from ${parser.name}: ${error}`)
    assert.equal(error.code, "PROTOCOL_ERROR")
  }
}

test("protocol parsers fail with stable PROTOCOL_ERROR across deterministic JSON fuzz", () => {
  const next = rng(0x524c4d31)
  for (let iteration = 0; iteration < 3000; iteration++) {
    const value = randomValue(next)
    const line = JSON.stringify(value)
    if (line === undefined) continue
    assertStableParser(parseHostMessage, line)
    assertStableParser(parseSandboxMessage, line)
    try {
      validateErrorInfo(value)
    } catch (error) {
      assert.ok(error instanceof RlmError)
      assert.equal(error.code, "PROTOCOL_ERROR")
    }
  }
})

test("authenticated frame parsing ignores wrong channels and keeps malformed payload errors stable", () => {
  const channel = "a".repeat(48)
  assert.equal(parseSandboxFrame(`RLM1:${"b".repeat(48)}:{}`, channel), null)
  assert.throws(
    () => parseSandboxFrame(`RLM1:${channel}:{bad-json`, channel),
    (error) => error instanceof RlmError && error.code === "PROTOCOL_ERROR",
  )
})
