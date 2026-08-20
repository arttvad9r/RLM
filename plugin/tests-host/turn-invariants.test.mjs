import assert from "node:assert/strict"
import test from "node:test"

import { TurnGovernor } from "../rlm-lib/turn.ts"
import { RlmError } from "../rlm-lib/errors.ts"

function clientFor(turn) {
  const messages = []
  for (let index = 1; index <= turn; index++) {
    messages.push({ info: { id: `user-${index}`, role: "user" } })
    messages.push({ info: { id: `assistant-${index}`, role: "assistant" } })
  }
  return { session: { messages: async () => ({ data: messages }) } }
}

function shuffle(values, seed) {
  let state = seed >>> 0
  const next = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 0x100000000)
  const result = [...values]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

test("next user turn stays blocked until every reserved exec settles, regardless of finish order", async () => {
  for (let round = 0; round < 20; round++) {
    const governor = new TurnGovernor()
    const sessionID = `session-${round}`
    const reservations = []
    for (let index = 0; index < 8; index++) {
      const started = await governor.beginExec(clientFor(1), sessionID, "/workspace", "assistant-1", 100 + index)
      assert.equal(started.allowed, true)
      reservations.push({ turnId: started.snapshot.turnId, reservedWallMs: started.reservedWallMs })
    }
    const order = shuffle(reservations, 0x524c4d + round)
    for (let index = 0; index < order.length; index++) {
      const current = order[index]
      assert.equal(governor.finishExecForTurn(sessionID, current.turnId, index + 1, current.reservedWallMs), true)
      if (index < order.length - 1) {
        await assert.rejects(
          () => governor.beginExec(clientFor(2), sessionID, "/workspace", "assistant-2", 100),
          (error) => error instanceof RlmError && /prior-turn exec\(s\) are still active/.test(error.message),
        )
      }
    }
    const next = await governor.beginExec(clientFor(2), sessionID, "/workspace", "assistant-2", 100)
    assert.equal(next.allowed, true)
    assert.equal(next.snapshot.turnId, "user-2")
    governor.finishExecForTurn(sessionID, next.snapshot.turnId, 1, next.reservedWallMs)
  }
})
