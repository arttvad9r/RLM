import assert from "node:assert/strict"
import test from "node:test"

import { RlmError } from "../rlm-lib/errors.ts"
import { TurnGovernor } from "../rlm-lib/turn.ts"

function delayedMessagesClient() {
  const resolvers = []
  let calls = 0
  return {
    client: {
      session: {
        messages: async () => {
          calls++
          return await new Promise((resolve) => resolvers.push(resolve))
        },
      },
    },
    calls: () => calls,
    resolveOne() {
      const resolve = resolvers.shift()
      assert.ok(resolve, "expected a pending session.messages call")
      resolve({
        data: [
          { info: { id: "user-1", role: "user" } },
          { info: { id: "assistant-1", role: "assistant" } },
        ],
      })
    },
  }
}

async function waitForCall(harness) {
  while (harness.calls() === 0) await new Promise((resolve) => setImmediate(resolve))
}

test("session deletion invalidates an in-flight beginExec turn lookup", async () => {
  const governor = new TurnGovernor()
  const harness = delayedMessagesClient()
  const pending = governor.beginExec(harness.client, "session", "/workspace", "assistant-1", 100)

  await waitForCall(harness)
  assert.equal(governor.evictSession("session"), true)
  harness.resolveOne()

  await assert.rejects(
    pending,
    (error) => error instanceof RlmError
      && error.code === "RUNTIME_ERROR"
      && /was deleted while rlm_exec was resolving turn authority/.test(error.message),
  )
  assert.equal(governor.snapshot("session"), null)
})

test("session deletion invalidates queued beginExec calls until the existing queue drains", async () => {
  const governor = new TurnGovernor()
  const harness = delayedMessagesClient()
  const first = governor.beginExec(harness.client, "session", "/workspace", "assistant-1", 100)
  const second = governor.beginExec(harness.client, "session", "/workspace", "assistant-1", 100)

  await waitForCall(harness)
  governor.evictSession("session")
  harness.resolveOne()

  await assert.rejects(first, /was deleted while rlm_exec was resolving turn authority/)
  await assert.rejects(second, /was deleted while rlm_exec was resolving turn authority/)
  assert.equal(harness.calls(), 1, "queued beginExec must fail before issuing another session.messages call")
  assert.equal(governor.snapshot("session"), null)
})
