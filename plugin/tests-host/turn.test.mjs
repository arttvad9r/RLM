import assert from "node:assert/strict"
import test from "node:test"

import {
  MAX_CHILD_CALLS_PER_TURN,
  MAX_CONTEXT_CALLS_PER_TURN,
  MAX_CONTEXT_CHARS_PER_TURN,
  MAX_MEMORY_CALLS_PER_TURN,
  MAX_MEMORY_ENTRIES_PER_TURN,
  MAX_MEMORY_KEY_CHARS,
  MAX_MEMORY_TOTAL_CHARS_PER_TURN,
  MAX_MEMORY_VALUE_CHARS,
  MAX_RLM_EXECS_PER_TURN,
  MAX_RLM_WALL_MS_PER_TURN,
} from "../rlm-lib/constants.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { TurnGovernor } from "../rlm-lib/turn.ts"

function client(getMessages) {
  return { session: { messages: async () => getMessages() } }
}

function turnMessages(userID, assistantID) {
  return { data: [
    { info: { id: userID, role: "user" } },
    { info: { id: assistantID, role: "assistant" } },
  ] }
}

test("turn identity lookup errors fail closed without resetting accumulated budget", async () => {
  const governor = new TurnGovernor()
  let failLookup = false
  const sdk = client(() => failLookup ? { error: { code: "transient" } } : turnMessages("user-1", "assistant-1"))

  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
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

test("missing preceding user message id fails closed", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "assistant-1", role: "assistant" } }] }))
  await assert.rejects(
    () => governor.beginExec(sdk, "session-1", "/workspace", "assistant-1"),
    (error) => error instanceof RlmError && error.code === "RUNTIME_ERROR" && /no preceding user message id/.test(error.message),
  )
  assert.equal(governor.snapshot("session-1")?.execCount, 0)
})

test("unknown assistant message id fails closed", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => turnMessages("user-1", "assistant-1"))
  await assert.rejects(
    () => governor.beginExec(sdk, "session-1", "/workspace", "assistant-missing"),
    (error) => error instanceof RlmError && error.code === "RUNTIME_ERROR" && /assistant message id not found/.test(error.message),
  )
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
  const sdk = client(() => turnMessages("user-1", "assistant-1"))
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
  const sdk = client(() => turnMessages("user-1", "assistant-1"))

  for (let index = 0; index < MAX_RLM_EXECS_PER_TURN; index++) {
    assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
  }
  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, false)
  for (let index = 0; index < MAX_CHILD_CALLS_PER_TURN; index++) governor.registerChildStart("session-1")
  assert.equal(governor.childAllowed("session-1"), false)
  for (let index = 0; index < MAX_CONTEXT_CALLS_PER_TURN; index++) assert.equal(governor.beginContextCall("session-1"), true)
  assert.equal(governor.beginContextCall("session-1"), false)
  assert.equal(governor.addContextChars("session-1", MAX_CONTEXT_CHARS_PER_TURN), true)
  assert.equal(governor.addContextChars("session-1", 1), false)
})

test("a new user message resets the working turn budget at its assistant boundary", async () => {
  const governor = new TurnGovernor()
  let history = turnMessages("user-1", "assistant-1")
  const sdk = client(() => history)

  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
  governor.registerChildStart("session-1")
  governor.beginContextCall("session-1")
  governor.addContextChars("session-1", 11)

  history = { data: [
    { info: { id: "user-1", role: "user" } },
    { info: { id: "assistant-1", role: "assistant" } },
    { info: { id: "user-2", role: "user" } },
    { info: { id: "assistant-2", role: "assistant" } },
  ] }
  const next = await governor.beginExec(sdk, "session-1", "/workspace", "assistant-2")
  assert.equal(next.allowed, true)
  assert.equal(next.snapshot.turnId, "user-2")
  assert.equal(next.snapshot.execCount, 1)
  assert.equal(next.snapshot.childCallCount, 0)
  assert.equal(next.snapshot.contextCallCount, 0)
  assert.equal(next.snapshot.contextCharsSent, 0)
})

test("stale assistant message cannot roll an already newer turn backward", async () => {
  const governor = new TurnGovernor()
  const history = { data: [
    { info: { id: "user-old", role: "user" } },
    { info: { id: "assistant-old", role: "assistant" } },
    { info: { id: "user-new", role: "user" } },
    { info: { id: "assistant-new", role: "assistant" } },
  ] }
  const sdk = client(() => history)
  await governor.beginExec(sdk, "session-1", "/workspace", "assistant-new")
  const before = governor.snapshot("session-1")
  await assert.rejects(
    () => governor.beginExec(sdk, "session-1", "/workspace", "assistant-old"),
    (error) => error instanceof RlmError && error.code === "RUNTIME_ERROR" && /stale RLM tool call/.test(error.message),
  )
  assert.deepEqual(governor.snapshot("session-1"), before)
})

test("wall reservation blocks concurrent execs and is released by finishExec", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => turnMessages("user-1", "assistant-1"))
  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
  governor.reserveExec("session-1", MAX_RLM_WALL_MS_PER_TURN)
  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, false)
  governor.finishExec("session-1", 0, MAX_RLM_WALL_MS_PER_TURN)
  assert.equal((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, true)
})

test("beginExec reserves wall atomically across concurrent starts", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => turnMessages("user-1", "assistant-1"))
  const [first, second] = await Promise.all([
    governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", MAX_RLM_WALL_MS_PER_TURN),
    governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", MAX_RLM_WALL_MS_PER_TURN),
  ])
  assert.equal([first, second].filter((result) => result.allowed).length, 1)
  assert.equal(first.reservedWallMs + second.reservedWallMs, MAX_RLM_WALL_MS_PER_TURN)
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
          return turnMessages("user-old", "assistant-old")
        }
        return { data: [
          { info: { id: "user-old", role: "user" } },
          { info: { id: "assistant-old", role: "assistant" } },
          { info: { id: "user-new", role: "user" } },
          { info: { id: "assistant-new", role: "assistant" } },
        ] }
      },
    },
  }

  const older = governor.beginExec(sdk, "session-1", "/workspace", "assistant-old")
  await oldStarted
  const newer = governor.beginExec(sdk, "session-1", "/workspace", "assistant-new")
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
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
    return turnMessages("user-a", "assistant-a")
  })
  const clientB = client(() => turnMessages("user-b", "assistant-b"))

  const a = governor.beginExec(clientA, "session-a", "/workspace", "assistant-a")
  await startedA
  const b = await governor.beginExec(clientB, "session-b", "/workspace", "assistant-b")
  assert.equal(b.snapshot.turnId, "user-b")
  releaseA()
  assert.equal((await a).snapshot.turnId, "user-a")
})


test("turn-scoped working memory persists across execs and resets on the next user turn", async () => {
  const governor = new TurnGovernor()
  let history = turnMessages("user-1", "assistant-1")
  const sdk = client(() => history)

  const first = await governor.beginExec(sdk, "session-memory", "/workspace", "assistant-1")
  assert.equal(first.allowed, true)
  assert.equal(governor.beginMemoryCallForTurn("session-memory", "user-1"), true)
  governor.memorySetForTurn("session-memory", "user-1", "audit:candidates", { paths: ["src/a.ts", "src/b.ts"] })
  assert.deepEqual(
    governor.memoryGetForTurn("session-memory", "user-1", "audit:candidates"),
    { found: true, value: { paths: ["src/a.ts", "src/b.ts"] } },
  )
  assert.deepEqual(governor.memoryKeysForTurn("session-memory", "user-1"), ["audit:candidates"])

  const second = await governor.beginExec(sdk, "session-memory", "/workspace", "assistant-1")
  assert.equal(second.allowed, true)
  assert.deepEqual(
    governor.memoryGetForTurn("session-memory", "user-1", "audit:candidates"),
    { found: true, value: { paths: ["src/a.ts", "src/b.ts"] } },
  )
  assert.equal(governor.snapshot("session-memory")?.memoryEntries, 1)

  history = { data: [
    { info: { id: "user-1", role: "user" } },
    { info: { id: "assistant-1", role: "assistant" } },
    { info: { id: "user-2", role: "user" } },
    { info: { id: "assistant-2", role: "assistant" } },
  ] }
  await governor.beginExec(sdk, "session-memory", "/workspace", "assistant-2")
  assert.deepEqual(governor.memoryGetForTurn("session-memory", "user-2", "audit:candidates"), { found: false })
  assert.equal(governor.snapshot("session-memory")?.memoryEntries, 0)
  assert.equal(governor.snapshot("session-memory")?.memoryCharsStored, 0)
})

test("turn-scoped working memory enforces call, key, entry, value and total-size bounds", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => turnMessages("user-memory-limits", "assistant-memory-limits"))
  await governor.beginExec(sdk, "session-memory-limits", "/workspace", "assistant-memory-limits")

  for (let index = 0; index < MAX_MEMORY_CALLS_PER_TURN; index++) {
    assert.equal(governor.beginMemoryCallForTurn("session-memory-limits", "user-memory-limits"), true)
  }
  assert.equal(governor.beginMemoryCallForTurn("session-memory-limits", "user-memory-limits"), false)

  assert.throws(
    () => governor.memorySetForTurn("session-memory-limits", "user-memory-limits", "k".repeat(MAX_MEMORY_KEY_CHARS + 1), 1),
    (error) => error instanceof RlmError && error.code === "BUDGET_EXCEEDED",
  )
  assert.throws(
    () => governor.memorySetForTurn("session-memory-limits", "user-memory-limits", "oversized", "x".repeat(MAX_MEMORY_VALUE_CHARS + 1)),
    (error) => error instanceof RlmError && error.code === "BUDGET_EXCEEDED",
  )

  for (let index = 0; index < MAX_MEMORY_ENTRIES_PER_TURN; index++) {
    governor.memorySetForTurn("session-memory-limits", "user-memory-limits", `entry:${index}`, index)
  }
  assert.throws(
    () => governor.memorySetForTurn("session-memory-limits", "user-memory-limits", "one-too-many", true),
    (error) => error instanceof RlmError && error.code === "BUDGET_EXCEEDED",
  )

  const totalGovernor = new TurnGovernor()
  await totalGovernor.beginExec(sdk, "session-memory-total", "/workspace", "assistant-memory-limits")
  const chunk = "x".repeat(Math.floor(MAX_MEMORY_TOTAL_CHARS_PER_TURN / 5))
  for (let index = 0; index < 4; index++) {
    totalGovernor.memorySetForTurn("session-memory-total", "user-memory-limits", `chunk:${index}`, chunk)
  }
  assert.throws(
    () => totalGovernor.memorySetForTurn("session-memory-total", "user-memory-limits", "overflow", "x".repeat(MAX_MEMORY_VALUE_CHARS)),
    (error) => error instanceof RlmError && error.code === "BUDGET_EXCEEDED",
  )
})

test("working memory delete reclaims capacity and session eviction destroys stored values", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => turnMessages("user-delete", "assistant-delete"))
  await governor.beginExec(sdk, "session-delete", "/workspace", "assistant-delete")
  governor.memorySetForTurn("session-delete", "user-delete", "temp", { large: "x".repeat(1000) })
  const before = governor.snapshot("session-delete")
  assert.equal(governor.memoryDeleteForTurn("session-delete", "user-delete", "temp"), true)
  assert.equal(governor.memoryDeleteForTurn("session-delete", "user-delete", "temp"), false)
  assert.ok((governor.snapshot("session-delete")?.memoryCharsStored ?? Infinity) < (before?.memoryCharsStored ?? 0))
  governor.memorySetForTurn("session-delete", "user-delete", "secret-work", [1, 2, 3])
  assert.equal(governor.evictSession("session-delete"), true)
  assert.equal(governor.snapshot("session-delete"), null)
  assert.throws(
    () => governor.memoryGetForTurn("session-delete", "user-delete", "secret-work"),
    (error) => error instanceof RlmError && error.code === "RUNTIME_ERROR",
  )
})
