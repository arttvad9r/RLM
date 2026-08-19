import assert from "node:assert/strict"
import test from "node:test"

import { callChildLlm } from "../rlm-lib/child.ts"
import { RlmError } from "../rlm-lib/errors.ts"

const log = async () => {}

function clientWithInventory(data) {
  let creates = 0
  let prompts = 0
  return {
    client: {
      session: {
        messages: async () => ({ data: [{ info: { id: "user-1", role: "user", model: { providerID: "p", modelID: "m" } } }] }),
        create: async () => { creates++; return { data: { id: "child" } } },
        abort: async () => {},
        prompt: async () => { prompts++; return { data: { info: { finish: "stop" }, parts: [{ type: "text", text: "ok" }] } } },
      },
      tool: { ids: async () => ({ data }) },
    },
    counts: () => ({ creates, prompts }),
  }
}

async function rejectsInventory(data) {
  const fixture = clientWithInventory(data)
  await assert.rejects(
    () => callChildLlm(
      fixture.client,
      { prompt: "x", parentSessionID: "root", parentTurnID: "user-1", directory: "/w" },
      log,
    ),
    (error) => error instanceof RlmError
      && error.code === "CHILD_FAILED"
      && /tool\.ids\(\) returned an invalid/.test(error.message),
  )
  assert.deepEqual(fixture.counts(), { creates: 0, prompts: 0 })
}

test("child rejects a string tool inventory instead of iterating tool-id characters", async () => {
  await rejectsInventory("bash")
})

test("child rejects non-string, empty and sparse tool inventory entries", async () => {
  await rejectsInventory(["read", 7])
  await rejectsInventory(["read", ""])
  const sparse = new Array(2)
  sparse[0] = "read"
  await rejectsInventory(sparse)
})
