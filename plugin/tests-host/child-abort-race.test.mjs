import assert from "node:assert/strict"
import test from "node:test"

import { callChildLlm } from "../rlm-lib/child.ts"
import { activeRlmChildCount } from "../rlm-lib/child-system.ts"
import { RlmError } from "../rlm-lib/errors.ts"

const log = async () => {}

function hangingClient() {
  let abortCalls = 0
  let promptStartedResolve
  const promptStarted = new Promise((resolve) => { promptStartedResolve = resolve })
  return {
    client: {
      session: {
        messages: async () => ({
          data: [{ info: { id: "user-1", role: "user", model: { providerID: "provider", modelID: "model" } } }],
        }),
        create: async () => ({ data: { id: "child-hang" } }),
        abort: async () => {
          abortCalls++
          return {}
        },
        prompt: async () => {
          promptStartedResolve()
          return await new Promise(() => {})
        },
      },
      tool: { ids: async () => ({ data: ["read"] }) },
    },
    promptStarted,
    getAbortCalls: () => abortCalls,
  }
}

test("parent abort settles child call even when SDK prompt never settles", async () => {
  const harness = hangingClient()
  const controller = new AbortController()
  const call = callChildLlm(
    harness.client,
    {
      prompt: "x",
      parentSessionID: "root",
      parentTurnID: "user-1",
      directory: "/workspace",
      signal: controller.signal,
    },
    log,
  )

  await harness.promptStarted
  assert.equal(activeRlmChildCount(), 1)
  controller.abort()

  await assert.rejects(
    call,
    (error) => error instanceof RlmError
      && error.code === "CHILD_FAILED"
      && /parent aborted during child prompt/.test(error.message),
  )
  assert.equal(harness.getAbortCalls(), 1)
  assert.equal(activeRlmChildCount(), 0)
})
