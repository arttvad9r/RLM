import assert from "node:assert/strict"
import test from "node:test"

import plugin from "../rlm.ts"
import { TurnGovernor, turnGovernor } from "../rlm-lib/turn.ts"

function messagesClient(userMessageID = "user-1") {
  const assistantMessageID = `assistant-${userMessageID.replace(/^user-/, "")}`
  return {
    session: {
      messages: async () => ({ data: [
        { info: { id: userMessageID, role: "user" } },
        { info: { id: assistantMessageID, role: "assistant" } },
      ] }),
    },
  }
}

test("TurnGovernor evicts one deleted session and leaves later accounting fail-closed", async () => {
  const governor = new TurnGovernor()
  const sessionID = "root-session"
  const started = await governor.beginExec(messagesClient(), sessionID, "/repo", "assistant-1", 100)
  assert.equal(started.allowed, true)
  assert.ok(governor.snapshot(sessionID))
  assert.equal(governor.evictSession(sessionID), true)
  assert.equal(governor.snapshot(sessionID), null)
  assert.equal(governor.childAllowed(sessionID), false)
  assert.equal(governor.beginContextCall(sessionID), false)
  assert.equal(governor.addContextChars(sessionID, 1), false)
  governor.finishExec(sessionID, 10, 100)
  assert.equal(governor.snapshot(sessionID), null)
  assert.equal(governor.evictSession("unknown-session"), false)
})

test("plugin session.deleted subscription evicts the matching root turn cache", async () => {
  const sessionID = `session-delete-${Date.now()}-${Math.random()}`
  const started = await turnGovernor.beginExec(messagesClient("user-hook"), sessionID, "/repo", "assistant-hook", 100)
  assert.equal(started.allowed, true)
  assert.ok(turnGovernor.snapshot(sessionID))

  const registration = { dispose: async () => {} }
  const ctx = {
    location: { directory: "/repo", project: { canonical: "/repo" } },
    session: { hook: async () => registration },
    tool: {
      transform: async (apply) => {
        apply({ add: () => {} })
        return registration
      },
    },
    event: {
      subscribe: async function* () {
        yield { type: "session.deleted", data: { sessionID } }
      },
    },
  }

  const cleanup = await plugin.setup(ctx)
  for (let i = 0; i < 10 && turnGovernor.snapshot(sessionID); i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(turnGovernor.snapshot(sessionID), null)
  await cleanup?.()
})
