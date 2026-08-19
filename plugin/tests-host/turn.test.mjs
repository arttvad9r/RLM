import assert from "node:assert/strict"
import test from "node:test"

import {
  MAX_CHILD_CALLS_PER_TURN,
  MAX_CONTEXT_CALLS_PER_TURN,
  MAX_CONTEXT_CHARS_PER_TURN,
  MAX_RLM_EXECS_PER_TURN,
  MAX_RLM_WALL_MS_PER_TURN,
} from "../rlm-lib/constants.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { TurnGovernor } from "../rlm-lib/turn.ts"

function client(getMessages) {
  return {
    session: {
      messages: async () => getMessages(),
    },
  }
}

test("turn identity lookup errors fail closed without resetting accumulated budget", async () => {
  const governor = new TurnGovernor()
  let failLookup = false
  const sdk = client(() => failLookup
    ? { error: { code: "transient" } }
    : { data: [{ info: { id: "user-1", role: "user" } }] })

  const first = await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")
  assert.equal(first.allowed, true)
  governor.registerChildStart("session-1")
  assert.equal(governor.beginContextCall("session-1"), true)
  assert.equal(governor.addContextChars("session-1", 7), true)
  const before = governor.snapshot("session-1")

  failLookup = true
  await assert.rejects(
    () => governor.beginExec(sdk, "session-1", "/workspace", "assistant-2"),
    (error) => error instanceof RlmError && error.code === "RUNTIME_ERROR",
  )
  assert.deepEqual(governor.snapshot("session-1"), before)
})

test("missing user message id fails closed instead of falling back to session identity", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "assistant-only", role: "assistant" } }] }))
  await assert.rejects(
    () => governor.beginExec(sdk, "session-1", "/workspace", "assistant-1"),
    (error) => error instanceof RlmError && error.code === "RUNTIME_ERROR" && /no user message id/.test(error.message),
  )
  const snapshot = governor.snapshot("session-1")
  assert.equal(snapshot?.execCount, 0)
  assert.equal(snapshot?.turnId, "")
})

test("uninitialized turn accounting refuses child and context authority", () => {
  const governor = new TurnGovernor()
  assert.equal(governor.childAllowed("missing"), false)
  assert.equal(governor.beginContextCall("missing"), false)
  assert.equal(governor.addContextChars("missing", 1), false)
  governor.registerChildStart("missing")
  governor.reserveExec("missing", 100)
  governor.finishExec("missing", 100, 100)
  assert.equal(governor.snapshot("missing"), null)
})

test("invalid negative accounting cannot reduce an initialized turn budget", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "user-1", role: "user" } }] }))
  await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")
  governor.reserveExec("session-1", 100)
  governor.finishExec("session-1", 25, 100)
  const before = governor.snapshot("session-1")

  assert.equal(governor.addContextChars("session-1", -1), false)
  governor.reserveExec("session-1", -100)
  governor.finishExec("session-1", -100, -100)
  const after = governor.snapshot("session-1")
  assert.equal(after?.wallMsUsed, before?.wallMsUsed)
  assert.equal(after?.wallMsRemaining, before?.wallMsRemaining)
  assert.equal(after?.contextCharsSent, before?.contextCharsSent)
})

test("turn governor enforces exec, child, context and data budgets", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "user-1", role: "user" } }] }))

  for (let index = 0; index < MAX_RLM_EXECS_PER_TURN; index++) {
    assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
  }
  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, false)

  for (let index = 0; index < MAX_CHILD_CALLS_PER_TURN; index++) governor.registerChildStart("session-1")
  assert.equal(governor.childAllowed("session-1"), false)

  for (let index = 0; index < MAX_CONTEXT_CALLS_PER_TURN; index++) {
    assert.equal(governor.beginContextCall("session-1"), true)
  }
  assert.equal(governor.beginContextCall("session-1"), false)

  assert.equal(governor.addContextChars("session-1", MAX_CONTEXT_CHARS_PER_TURN), true)
  assert.equal(governor.addContextChars("session-1", 1), false)
})

test("a new user message resets the working turn budget", async () => {
  const governor = new TurnGovernor()
  let userMessageID = "user-1"
  const sdk = client(() => ({ data: [{ info: { id: userMessageID, role: "user" } }] }))

  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
  governor.registerChildStart("session-1")
  governor.beginContextCall("session-1")
  governor.addContextChars("session-1", 11)

  userMessageID = "user-2"
  const next = await governor.beginExec(sdk, "session-1", "/workspace", "assistant-2")
  assert.equal(next.allowed, true)
  assert.equal(next.snapshot.turnId, "user-2")
  assert.equal(next.snapshot.execCount, 1)
  assert.equal(next.snapshot.childCallCount, 0)
  assert.equal(next.snapshot.contextCallCount, 0)
  assert.equal(next.snapshot.contextCharsSent, 0)
})

test("wall reservation blocks concurrent execs and is released by finishExec", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "user-1", role: "user" } }] }))

  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
  governor.reserveExec("session-1", MAX_RLM_WALL_MS_PER_TURN)
  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, false)

  governor.finishExec("session-1", 0, MAX_RLM_WALL_MS_PER_TURN)
  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
})

test("beginExec reserves wall atomically across concurrent starts", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "user-1", role: "user" } }] }))

  const [first, second] = await Promise.all([
    governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", MAX_RLM_WALL_MS_PER_TURN),
    governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", MAX_RLM_WALL_MS_PER_TURN),
  ])
  const allowed = [first, second].filter((result) => result.allowed)
  assert.equal(allowed.length, 1)
  assert.equal(first.reservedWallMs + second.reservedWallMs, MAX_RLM_WALL_MS_PER_TURN)
  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", 1)).allowed, false)
})

test("overlapping turn lookups cannot roll session state backward when an older lookup resolves late", async () => {
  const governor = new TurnGovernor()
  let releaseOld
  let markOldStarted
  const oldGate = new Promise((resolve) => { releaseOld = resolve })
  const oldStarted = new Promise((resolve) => { markOldStarted = resolve })
  let calls = 0
  const sdk = {
    session: {
      messages: async () => {
        calls++
        if (calls === 1) {
          markOldStarted()
          await oldGate
          return { data: [{ info: { id: "user-old", role: "user" } }] }
        }
        return { data: [{ info: { id: "user-new", role: "user" } }] }
      },
    },
  }

  const older = governor.beginExec(sdk, "session-1", "/workspace", "assistant-old")
  await oldStarted
  const newer = governor.beginExec(sdk, "session-1", "/workspace", "assistant-new")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1, "new turn lookup must wait for the older cache transition in the same session")

  releaseOld()
  const [oldResult, newResult] = await Promise.all([older, newer])
  assert.equal(oldResult.snapshot.turnId, "user-old")
  assert.equal(newResult.snapshot.turnId, "user-new")
  assert.equal(governor.snapshot("session-1")?.turnId, "user-new")
  assert.equal(governor.snapshot("session-1")?.execCount, 1)
})

test("turn resolution locks are isolated per root session", async () => {
  const governor = new TurnGovernor()
  let releaseA
  let markAStarted
  const gateA = new Promise((resolve) => { releaseA = resolve })
  const startedA = new Promise((resolve) => { markAStarted = resolve })
  const clientA = client(async () => {
    markAStarted()
    await gateA
    return { data: [{ info: { id: "user-a", role: "user" } }] }
  })
  const clientB = client(() => ({ data: [{ info: { id: "user-b", role: "user" } }] }))

  const a = governor.beginExec(clientA, "session-a", "/workspace", "assistant-a")
  await startedA
  const b = await governor.beginExec(clientB, "session-b", "/workspace", "assistant-b")
  assert.equal(b.snapshot.turnId, "user-b")
  releaseA()
  assert.equal((await a).snapshot.turnId, "user-a")
})
