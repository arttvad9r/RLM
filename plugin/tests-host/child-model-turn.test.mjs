import assert from "node:assert/strict"
import test from "node:test"

import { callChildLlm } from "../rlm-lib/child.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { turnGovernor } from "../rlm-lib/turn.ts"

const log = async () => {}

function makeClient(getMessages) {
  let promptedModel
  let createCalls = 0
  return {
    client: {
      session: {
        messages: async () => ({ data: getMessages() }),
        create: async () => {
          createCalls++
          return { data: { id: `child-${createCalls}` } }
        },
        abort: async () => ({}),
        prompt: async ({ body }) => {
          promptedModel = body.model
          return { data: { info: { finish: "stop" }, parts: [{ type: "text", text: "answer" }] } }
        },
      },
      tool: { ids: async () => ({ data: ["read"] }) },
    },
    getModel: () => promptedModel,
    getCreateCalls: () => createCalls,
  }
}

test("production child model stays pinned to the active RLM user turn after a newer user message arrives", async () => {
  const sessionID = `child-model-turn-${Date.now()}-${Math.random()}`
  let messages = [
    { info: { id: "user-old", role: "user", model: { providerID: "provider", modelID: "old" } } },
    { info: { id: "assistant-old", role: "assistant" } },
  ]
  const harness = makeClient(() => messages)
  const started = await turnGovernor.beginExec(harness.client, sessionID, "/workspace", "assistant-old", 1_000)
  assert.equal(started.allowed, true)
  try {
    messages = [
      ...messages,
      { info: { id: "user-new", role: "user", model: { providerID: "provider", modelID: "new" } } },
      { info: { id: "assistant-new", role: "assistant" } },
    ]

    const result = await callChildLlm(
      harness.client,
      { prompt: "x", parentSessionID: sessionID, directory: "/workspace" },
      log,
    )
    assert.equal(result.model, "provider/old")
    assert.deepEqual(harness.getModel(), { providerID: "provider", modelID: "old" })
  } finally {
    turnGovernor.finishExec(sessionID, 1, started.reservedWallMs)
    turnGovernor.evictSession(sessionID)
  }
})

test("explicit unknown child turn id fails closed before child creation", async () => {
  const harness = makeClient(() => [
    { info: { id: "user-1", role: "user", model: { providerID: "provider", modelID: "model" } } },
  ])
  await assert.rejects(
    () => callChildLlm(
      harness.client,
      { prompt: "x", parentSessionID: "root", parentTurnID: "missing-user", directory: "/workspace" },
      log,
    ),
    (error) => error instanceof RlmError
      && error.code === "CHILD_FAILED"
      && /could not resolve root model for RLM user turn missing-user/.test(error.message),
  )
  assert.equal(harness.getCreateCalls(), 0)
})
