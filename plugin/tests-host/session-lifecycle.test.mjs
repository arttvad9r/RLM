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

test("plugin session.deleted hook evicts the matching root turn cache", async () => {
  const sessionID = `session-delete-${Date.now()}-${Math.random()}`
  const started = await turnGovernor.beginExec(messagesClient("user-hook"), sessionID, "/repo", "assistant-hook", 100)
  assert.equal(started.allowed, true)
  assert.ok(turnGovernor.snapshot(sessionID))

  const hooks = await plugin({
    client: { app: { log: async () => ({}) } },
    directory: "/repo",
    worktree: "/repo",
  })
  await hooks.event?.({
    event: {
      type: "session.deleted",
      properties: { info: { id: sessionID } },
    },
  })
  assert.equal(turnGovernor.snapshot(sessionID), null)
})
