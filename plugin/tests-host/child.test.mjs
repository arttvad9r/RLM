import assert from "node:assert/strict"
import test from "node:test"

import { callChildLlm } from "../rlm-lib/child.ts"
import { activeRlmChildCount } from "../rlm-lib/child-system.ts"
import { RlmError } from "../rlm-lib/errors.ts"

const log = async () => {}
const baseInput = { prompt: "x", parentSessionID: "root", parentTurnID: "user-1", directory: "/workspace" }

function baseClient(overrides = {}) {
  return {
    session: {
      messages: async () => ({
        data: [{ info: { id: "user-1", role: "user", model: { providerID: "provider", modelID: "model" } } }],
      }),
      create: async () => ({ data: { id: "child-1" } }),
      abort: async () => ({}),
      prompt: async () => ({ data: { info: { finish: "stop" }, parts: [{ type: "text", text: "answer" }] } }),
      ...overrides.session,
    },
    tool: {
      ids: async () => ({ data: ["read", "bash"] }),
      ...overrides.tool,
    },
  }
}

test("child refuses to start when tool inventory is empty", async () => {
  let createCalls = 0
  const client = baseClient({
    session: {
      create: async () => {
        createCalls++
        return { data: { id: "should-not-exist" } }
      },
    },
    tool: { ids: async () => ({ data: [] }) },
  })

  await assert.rejects(
    () => callChildLlm(client, baseInput, log),
    (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /empty list/.test(error.message),
  )
  assert.equal(createCalls, 0)
  assert.equal(activeRlmChildCount(), 0)
})

test("child prompt receives pinned-SDK model shape and a full deny map", async () => {
  let tools
  let model
  let bodyKeys
  const client = baseClient({
    session: {
      prompt: async ({ body }) => {
        tools = body.tools
        model = body.model
        bodyKeys = Object.keys(body).sort()
        return {
          data: {
            info: { finish: "stop", cost: 0.25, tokens: { input: 10, output: 4 } },
            parts: [{ type: "text", text: "answer" }],
          },
        }
      },
    },
    tool: { ids: async () => ({ data: ["read", "bash", "edit"] }) },
  })

  const result = await callChildLlm(client, baseInput, log)
  assert.deepEqual(model, { providerID: "provider", modelID: "model" })
  assert.deepEqual(bodyKeys, ["model", "parts", "tools"])
  assert.deepEqual(tools, { read: false, bash: false, edit: false, rlm_exec: false })
  assert.equal(result.model, "provider/model")
  assert.equal("variant" in result, false)
  assert.equal(result.deniedToolCount, 4)
  assert.equal(result.text, "answer")
  assert.equal(result.cost, 0.25)
  assert.equal(result.tokensInput, 10)
  assert.equal(result.tokensOutput, 4)
  assert.equal(activeRlmChildCount(), 0)
})

test("provider-side child errors always clean the active-child registry", async () => {
  const client = baseClient({
    session: {
      prompt: async () => ({
        data: {
          info: { finish: "error", error: { name: "ProviderError", data: { message: "boom" } } },
          parts: [],
        },
      }),
    },
  })

  await assert.rejects(
    () => callChildLlm(client, baseInput, log),
    (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /boom/.test(error.message),
  )
  assert.equal(activeRlmChildCount(), 0)
})

test("a pre-aborted parent aborts the child and still cleans registry state", async () => {
  let abortCalls = 0
  let promptCalls = 0
  const controller = new AbortController()
  controller.abort()
  const client = baseClient({
    session: {
      abort: async () => {
        abortCalls++
        return {}
      },
      prompt: async () => {
        promptCalls++
        return { data: { parts: [{ type: "text", text: "unexpected" }] } }
      },
    },
  })

  await assert.rejects(
    () => callChildLlm(client, { ...baseInput, signal: controller.signal }, log),
    (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /parent aborted/.test(error.message),
  )
  assert.equal(abortCalls, 1)
  assert.equal(promptCalls, 0)
  assert.equal(activeRlmChildCount(), 0)
})
