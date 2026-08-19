import assert from "node:assert/strict"
import test from "node:test"

import { RlmError } from "../rlm-lib/errors.ts"
import { TurnGovernor } from "../rlm-lib/turn.ts"

function delayedClient() {
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
    resolveOne() {
      resolvers.shift()?.({
        data: [
          { info: { id: "user-1", role: "user" } },
          { info: { id: "assistant-1", role: "assistant" } },
        ],
      })
    },
    calls: () => calls,
  }
}

async function waitForCall(harness) {
  while (harness.calls() === 0) await new Promise((resolve) => setImmediate(resolve))
}

test("session deletion invalidates an in-flight turn lookup and cannot resurrect cache state", async () => {
  const governor = new TurnGovernor()
  const harness = delayedClient()
  const pending = governor.beginExec(harness.client, "session-1", "/workspace", "assistant-1", 100)

  await waitForCall(harness)
  assert.equal(governor.evictSession("session-1"), true)
  harness.resolveOne()

  await assert.rejects(
    pending,
    (error) => error instanceof RlmError
      && error.code === "RUNTIME_ERROR"
      && /session was deleted/.test(error.message),
  )
  assert.equal(governor.snapshot("session-1"), null)
})

test("queued beginExec calls are invalidated without starting another SDK lookup", async () => {
  const governor = new TurnGovernor()
  const harness = delayedClient()
  const first = governor.beginExec(harness.client, "session-1", "/workspace", "assistant-1", 100)
  const second = governor.beginExec(harness.client, "session-1", "/workspace", "assistant-1", 100)

  await waitForCall(harness)
  governor.evictSession("session-1")
  harness.resolveOne()

  await assert.rejects(first, /session was deleted/)
  await assert.rejects(second, /session was deleted/)
  assert.equal(harness.calls(), 1, "queued lookup must fail before a second session.messages call")
  assert.equal(governor.snapshot("session-1"), null)
})

test("deletion remains fail-closed when the in-flight lookup would otherwise complete successfully", async () => {
  const governor = new TurnGovernor()
  const harness = delayedClient()
  const pending = governor.beginExec(harness.client, "session-1", "/workspace", "assistant-1", 100)

  await waitForCall(harness)
  governor.evictSession("session-1")
  harness.resolveOne()

  await assert.rejects(pending, /session was deleted/)
  assert.equal(governor.childAllowed("session-1"), false)
  assert.equal(governor.beginContextCall("session-1"), false)
  assert.equal(governor.snapshot("session-1"), null)
})
