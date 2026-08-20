import assert from "node:assert/strict"
import test from "node:test"

import {
  MAX_CHILD_RESULT_CHARS,
  MAX_CHILD_TOOL_ID_CHARS,
  MAX_CHILD_TOOL_IDS,
} from "../rlm-lib/constants.ts"
import { callChildLlm } from "../rlm-lib/child.ts"
import { activeRlmChildCount } from "../rlm-lib/child-system.ts"
import { RlmError } from "../rlm-lib/errors.ts"

const log = async () => {}

function clientFor({ toolIDs = ["read"], parts = [{ type: "text", text: "ok" }] } = {}) {
  let creates = 0
  let prompts = 0
  return {
    client: {
      session: {
        messages: async () => ({
          data: [{ info: { id: "user-1", role: "user", model: { providerID: "p", modelID: "m" } } }],
        }),
        create: async () => {
          creates++
          return { data: { id: `child-${creates}` } }
        },
        abort: async () => ({}),
        prompt: async () => {
          prompts++
          return { data: { info: { finish: "stop" }, parts } }
        },
      },
      tool: { ids: async () => ({ data: toolIDs }) },
    },
    counts: () => ({ creates, prompts }),
  }
}

function input() {
  return {
    prompt: "work",
    parentSessionID: "root",
    parentUserMessageID: "user-1",
    directory: "/workspace",
  }
}

test("child rejects oversized tool inventories before session creation", async () => {
  const tooMany = clientFor({ toolIDs: Array.from({ length: MAX_CHILD_TOOL_IDS + 1 }, (_, i) => `tool-${i}`) })
  await assert.rejects(
    () => callChildLlm(tooMany.client, input(), log),
    (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /safety limit/.test(error.message),
  )
  assert.deepEqual(tooMany.counts(), { creates: 0, prompts: 0 })

  const tooLong = clientFor({ toolIDs: ["x".repeat(MAX_CHILD_TOOL_ID_CHARS + 1)] })
  await assert.rejects(
    () => callChildLlm(tooLong.client, input(), log),
    (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /invalid tool id/.test(error.message),
  )
  assert.deepEqual(tooLong.counts(), { creates: 0, prompts: 0 })
})

test("child bounds text while accumulating provider response parts", async () => {
  const fixture = clientFor({
    parts: [
      { type: "text", text: "a".repeat(Math.floor(MAX_CHILD_RESULT_CHARS / 2) + 1) },
      { type: "text", text: "b".repeat(Math.floor(MAX_CHILD_RESULT_CHARS / 2) + 1) },
    ],
  })
  await assert.rejects(
    () => callChildLlm(fixture.client, input(), log),
    (error) => error instanceof RlmError && error.code === "BUDGET_EXCEEDED" && /llm result exceeds/.test(error.message),
  )
  assert.deepEqual(fixture.counts(), { creates: 1, prompts: 1 })
  assert.equal(activeRlmChildCount(), 0)
})
