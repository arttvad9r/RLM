import assert from "node:assert/strict"
import test from "node:test"

import { callChildLlm } from "../rlm-lib/child.ts"
import { activeRlmChildCount } from "../rlm-lib/child-system.ts"
import { RlmError } from "../rlm-lib/errors.ts"

const log = async () => {}
const validMessages = () => ({ data: [{ info: { id: "user-1", role: "user", model: { providerID: "p", modelID: "m" } } }] })
const validTools = () => ({ data: ["read"] })
const validCreate = () => ({ data: { id: "child-1" } })
const validPrompt = () => ({ data: { info: { finish: "stop" }, parts: [{ type: "text", text: "ok" }] } })

function fixture(stage, behavior) {
  const fail = (name, valid) => (...args) => {
    if (name !== stage) return Promise.resolve(valid(...args))
    if (behavior === "sync") throw new Error(`${name}-sync`)
    if (behavior === "reject") return Promise.reject(new Error(`${name}-reject`))
    throw new Error(`unknown behavior ${behavior}`)
  }
  return {
    session: {
      messages: fail("messages", validMessages),
      create: fail("create", validCreate),
      abort: async () => ({}),
      prompt: fail("prompt", validPrompt),
    },
    tool: { ids: fail("tool.ids", validTools) },
  }
}

for (const stage of ["messages", "tool.ids", "create", "prompt"]) {
  for (const behavior of ["sync", "reject"]) {
    test(`child normalizes ${behavior} ${stage} failures to CHILD_FAILED`, async () => {
      await assert.rejects(
        () => callChildLlm(fixture(stage, behavior), {
          prompt: "work",
          parentSessionID: "root",
          parentUserMessageID: "user-1",
          directory: "/workspace",
        }, log),
        (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && error.message.includes(stage),
      )
      assert.equal(activeRlmChildCount(), 0)
    })
  }
}

test("pre-aborted child fails before touching any SDK authority", async () => {
  let calls = 0
  const touched = () => { calls++; throw new Error("must not be called") }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => callChildLlm({
      session: { messages: touched, create: touched, abort: touched, prompt: touched },
      tool: { ids: touched },
    }, {
      prompt: "work",
      parentSessionID: "root",
      parentUserMessageID: "user-1",
      directory: "/workspace",
      signal: controller.signal,
    }, log),
    (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /before child setup/.test(error.message),
  )
  assert.equal(calls, 0)
  assert.equal(activeRlmChildCount(), 0)
})
