import assert from "node:assert/strict"
import test from "node:test"

import {
  isRlmContextPathAllowed,
  resolveRlmContextPolicy,
} from "../rlm-lib/context-policy.ts"
import {
  encodeSandboxFrame,
  parseHostMessage,
  parseSandboxFrame,
  validateErrorInfo,
} from "../rlm-lib/protocol.ts"

const CHANNEL = "0123456789abcdef0123456789abcdef0123456789abcdef"
const OTHER_CHANNEL = "abcdef0123456789abcdef0123456789abcdef0123456789"

test("secret and VCS namespaces are hidden at every path depth", () => {
  const policy = resolveRlmContextPolicy({})
  for (const candidate of [
    ".env",
    ".envrc",
    ".env_backup",
    ".env-local",
    "apps/api/.env.production",
    "apps/api/.envrc",
    "apps/api/.env_backup",
    "apps/api/.env.production/secret",
    "src/.env/local",
    ".git/config",
    "src/.git/objects/x",
  ]) {
    assert.equal(isRlmContextPathAllowed(candidate, policy), false, candidate)
  }
  assert.equal(isRlmContextPathAllowed(".env.example", policy), true)
  assert.equal(isRlmContextPathAllowed("fixtures/.env.example/value", policy), true)
})

test("context policy cannot widen hard limits and rejects traversal", () => {
  const policy = resolveRlmContextPolicy({
    OPENCODE_RLM_CONTEXT_POLICY: JSON.stringify({
      allowed_paths: ["src/core"],
      max_read_bytes: 999_999_999,
      max_grep_matches: 7,
      max_list_entries: 19,
    }),
  })
  assert.equal(policy.maxReadBytes, 128 * 1024)
  assert.equal(policy.maxGrepMatches, 7)
  assert.equal(policy.maxListEntries, 19)
  assert.equal(isRlmContextPathAllowed("src/core/a.ts", policy), true)
  assert.equal(isRlmContextPathAllowed("src/other.ts", policy), false)
  assert.throws(
    () => resolveRlmContextPolicy({ OPENCODE_RLM_CONTEXT_POLICY: JSON.stringify({ allowed_paths: ["../escape"] }) }),
    /parent traversal is not allowed/,
  )
})

test("host result envelopes are complete and mutually exclusive", () => {
  assert.equal(
    parseHostMessage('{"v":1,"type":"llm_result","id":"x","ok":true,"text":"ok"}').text,
    "ok",
  )
  assert.throws(
    () => parseHostMessage('{"v":1,"type":"llm_result","id":"x","ok":true}'),
    /missing string text/,
  )
  assert.throws(
    () => parseHostMessage('{"v":1,"type":"llm_result","id":"x","ok":false}'),
    /missing error envelope/,
  )
  assert.throws(
    () => parseHostMessage('{"v":1,"type":"llm_result","id":"x","ok":true,"text":"ok","error":{"code":"CHILD_FAILED","message":"x"}}'),
    /must not include error/,
  )

  assert.equal(
    parseHostMessage('{"v":1,"type":"context_result","id":"x","ok":true,"value":null}').value,
    null,
  )
  assert.throws(
    () => parseHostMessage('{"v":1,"type":"context_result","id":"x","ok":true}'),
    /missing value/,
  )
  assert.throws(
    () => parseHostMessage('{"v":1,"type":"context_result","id":"x","ok":false,"error":{"code":"READ_FAILED","message":"x"},"value":null}'),
    /must not include value/,
  )
})

test("authenticated sandbox frames cannot be forged with raw stdout or another channel", () => {
  const line = encodeSandboxFrame(CHANNEL, { v: 1, type: "result", value: "ok" })
  assert.equal(parseSandboxFrame(line, CHANNEL)?.type, "result")
  assert.equal(parseSandboxFrame(line, OTHER_CHANNEL), null)
  assert.equal(parseSandboxFrame('{"v":1,"type":"result","value":"forged"}', CHANNEL), null)
})

test("unknown protocol error codes fail closed", () => {
  assert.throws(() => validateErrorInfo({ code: "NOT_A_REAL_CODE", message: "x" }), /unknown error code/)
})
