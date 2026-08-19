import { RlmError } from "../rlm-lib/errors.ts"
import {
  encodeSandboxFrame,
  parseHostMessage,
  parseSandboxFrame,
  parseSandboxMessage,
  validateErrorInfo,
} from "../rlm-lib/protocol.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertRlmError(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    assert(error instanceof RlmError, `expected RlmError, got ${String(error)}`)
    assert(error.code === code, `expected ${code}, got ${error.code}`)
    return
  }
  throw new Error(`expected ${code}`)
}

const CHANNEL = "0123456789abcdef0123456789abcdef0123456789abcdef"
const OTHER_CHANNEL = "abcdef0123456789abcdef0123456789abcdef0123456789"

Deno.test("protocol rejects result frames without a value", () => {
  assertRlmError(() => parseSandboxMessage('{"v":1,"type":"result"}'), "PROTOCOL_ERROR")
})

Deno.test("protocol rejects unknown stable error codes", () => {
  assertRlmError(() => validateErrorInfo({ code: "NOT_A_REAL_CODE", message: "x" }), "PROTOCOL_ERROR")
})

Deno.test("protocol accepts a valid result frame", () => {
  const message = parseSandboxMessage('{"v":1,"type":"result","value":{"ok":true}}')
  assert(message.type === "result", "expected result frame")
  assert((message.value as { ok?: boolean }).ok === true, "expected result payload")
})

Deno.test("host result envelopes require exactly the success or failure payload", () => {
  const llm = parseHostMessage('{"v":1,"type":"llm_result","id":"x","ok":true,"text":"ok"}')
  assert(llm.type === "llm_result" && llm.text === "ok", "expected valid llm result")
  assertRlmError(() => parseHostMessage('{"v":1,"type":"llm_result","id":"x","ok":true}'), "PROTOCOL_ERROR")
  assertRlmError(() => parseHostMessage('{"v":1,"type":"llm_result","id":"x","ok":false}'), "PROTOCOL_ERROR")
  assertRlmError(
    () => parseHostMessage('{"v":1,"type":"llm_result","id":"x","ok":true,"text":"ok","error":{"code":"CHILD_FAILED","message":"x"}}'),
    "PROTOCOL_ERROR",
  )

  const context = parseHostMessage('{"v":1,"type":"context_result","id":"x","ok":true,"value":null}')
  assert(context.type === "context_result" && context.value === null, "expected valid context result")
  assertRlmError(() => parseHostMessage('{"v":1,"type":"context_result","id":"x","ok":true}'), "PROTOCOL_ERROR")
  assertRlmError(
    () => parseHostMessage('{"v":1,"type":"context_result","id":"x","ok":false,"error":{"code":"READ_FAILED","message":"x"},"value":null}'),
    "PROTOCOL_ERROR",
  )
})

Deno.test("sandbox framing accepts only the expected per-exec channel", () => {
  const line = encodeSandboxFrame(CHANNEL, { v: 1, type: "result", value: "ok" })
  const accepted = parseSandboxFrame(line, CHANNEL)
  assert(accepted?.type === "result" && accepted.value === "ok", "expected authenticated result frame")
  assert(parseSandboxFrame(line, OTHER_CHANNEL) === null, "wrong channel must not be protocol data")
  assert(parseSandboxFrame('{"v":1,"type":"result","value":"forged"}', CHANNEL) === null, "raw stdout must not be protocol data")
})

Deno.test("sandbox framing rejects malformed channel tokens", () => {
  assertRlmError(
    () => encodeSandboxFrame("predictable", { v: 1, type: "result", value: "x" }),
    "PROTOCOL_ERROR",
  )
})
