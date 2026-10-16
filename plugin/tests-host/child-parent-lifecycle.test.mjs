import assert from "node:assert/strict"
import test from "node:test"

import { callChildLlm } from "../rlm-lib/child.ts"

const log = async () => {}

test("completed semantic child remains linked to the root session for host cascade deletion", async () => {
  let createArgs
  const client = {
    session: {
      messages: async () => ({
        data: [{ info: { role: "user", model: { providerID: "provider", modelID: "model" } } }],
      }),
      create: async (args) => {
        createArgs = args
        return { data: { id: "child-retained" } }
      },
      abort: async () => ({}),
      prompt: async () => ({
        data: { info: { finish: "stop" }, parts: [{ type: "text", text: "answer" }] },
      }),
    },
    tool: { ids: async () => ({ data: ["read", "bash"] }) },
  }

  const result = await callChildLlm(
    client,
    { prompt: "x", parentSessionID: "root-session", directory: "/workspace" },
    log,
  )

  assert.equal(result.childSessionID, "child-retained")
  assert.deepEqual(createArgs, {
    body: { parentID: "root-session", title: "rlm child", model: { providerID: "provider", modelID: "model" } },
    query: { directory: "/workspace" },
  })
})
