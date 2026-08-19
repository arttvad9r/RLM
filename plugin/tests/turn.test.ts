import {
  MAX_CHILD_CALLS_PER_TURN,
  MAX_CONTEXT_CALLS_PER_TURN,
  MAX_CONTEXT_CHARS_PER_TURN,
  MAX_RLM_EXECS_PER_TURN,
  MAX_RLM_WALL_MS_PER_TURN,
} from "../rlm-lib/constants.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { TurnGovernor } from "../rlm-lib/turn.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function client(getMessages: () => unknown | Promise<unknown>) {
  return { session: { messages: async () => await getMessages() as { error?: unknown; data?: Array<{ info?: { id?: string; role?: string } }> } } }
}

function turnMessages(userID: string, assistantID: string) {
  return { data: [
    { info: { id: userID, role: "user" } },
    { info: { id: assistantID, role: "assistant" } },
  ] }
}

Deno.test("turn lookup errors fail closed without resetting accumulated budget", async () => {
  const governor = new TurnGovernor()
  let failLookup = false
  const sdk = client(() => failLookup ? { error: { code: "transient" } } : turnMessages("user-1", "assistant-1"))
  assert((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, "first exec should start")
  governor.registerChildStart("session-1")
  governor.beginContextCall("session-1")
  governor.addContextChars("session-1", 7)
  const before = JSON.stringify(governor.snapshot("session-1"))
  failLookup = true
  try {
    await governor.beginExec(sdk, "session-1", "/workspace", "assistant-2")
  } catch (error) {
    assert(error instanceof RlmError && error.code === "RUNTIME_ERROR", "expected fail-closed lookup error")
    assert(JSON.stringify(governor.snapshot("session-1")) === before, "lookup error must not mutate budget")
    return
  }
  throw new Error("expected lookup failure")
})

Deno.test("assistant boundary must exist and have a preceding user message", async () => {
  const governor = new TurnGovernor()
  for (const [sdk, messageID, expected] of [
    [client(() => ({ data: [{ info: { id: "assistant-1", role: "assistant" } }] })), "assistant-1", "no preceding user"],
    [client(() => turnMessages("user-1", "assistant-1")), "assistant-missing", "assistant message id not found"],
  ] as const) {
    try {
      await governor.beginExec(sdk, "session-1", "/workspace", messageID)
    } catch (error) {
      assert(error instanceof RlmError && error.code === "RUNTIME_ERROR", "expected RUNTIME_ERROR")
      assert(error.message.includes(expected), `expected diagnostic containing ${expected}`)
      continue
    }
    throw new Error(`expected failure for ${messageID}`)
  }
})

Deno.test("turn governor enforces working budgets and rejects negative accounting", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => turnMessages("user-1", "assistant-1"))
  for (let index = 0; index < MAX_RLM_EXECS_PER_TURN; index++) {
    assert((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, `exec ${index + 1} should start`)
  }
  assert(!(await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, "exec limit must close")
  for (let index = 0; index < MAX_CHILD_CALLS_PER_TURN; index++) governor.registerChildStart("session-1")
  assert(!governor.childAllowed("session-1"), "child limit must close")
  for (let index = 0; index < MAX_CONTEXT_CALLS_PER_TURN; index++) assert(governor.beginContextCall("session-1"), "context call should fit")
  assert(!governor.beginContextCall("session-1"), "context-call limit must close")
  assert(governor.addContextChars("session-1", MAX_CONTEXT_CHARS_PER_TURN), "exact context byte budget should fit")
  assert(!governor.addContextChars("session-1", 1), "context char overflow must close")
  const before = governor.snapshot("session-1")
  assert(!governor.addContextChars("session-1", -1), "negative context chars must fail")
  governor.reserveExec("session-1", -1)
  governor.finishExec("session-1", -1, -1)
  assert(governor.snapshot("session-1")?.wallMsUsed === before?.wallMsUsed, "negative wall use must not mutate accounting")
})

Deno.test("new user turn resets budget at its exact assistant message boundary", async () => {
  const governor = new TurnGovernor()
  let history = turnMessages("user-1", "assistant-1")
  const sdk = client(() => history)
  await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")
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
  assert(next.snapshot.turnId === "user-2", "new user turn must be selected")
  assert(next.snapshot.execCount === 1 && next.snapshot.childCallCount === 0 && next.snapshot.contextCallCount === 0, "new turn budgets must reset")
})

Deno.test("stale assistant message cannot roll a newer turn backward", async () => {
  const governor = new TurnGovernor()
  const history = { data: [
    { info: { id: "user-old", role: "user" } },
    { info: { id: "assistant-old", role: "assistant" } },
    { info: { id: "user-new", role: "user" } },
    { info: { id: "assistant-new", role: "assistant" } },
  ] }
  const sdk = client(() => history)
  await governor.beginExec(sdk, "session-1", "/workspace", "assistant-new")
  const before = JSON.stringify(governor.snapshot("session-1"))
  try {
    await governor.beginExec(sdk, "session-1", "/workspace", "assistant-old")
  } catch (error) {
    assert(error instanceof RlmError && /stale RLM tool call/.test(error.message), "expected stale-call rejection")
    assert(JSON.stringify(governor.snapshot("session-1")) === before, "stale call must not mutate newer budget")
    return
  }
  throw new Error("expected stale assistant rejection")
})

Deno.test("beginExec wall reservation is atomic for concurrent starts", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => turnMessages("user-1", "assistant-1"))
  const [first, second] = await Promise.all([
    governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", MAX_RLM_WALL_MS_PER_TURN),
    governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", MAX_RLM_WALL_MS_PER_TURN),
  ])
  assert([first, second].filter((result) => result.allowed).length === 1, "exactly one full-wall reservation should start")
  assert(first.reservedWallMs + second.reservedWallMs === MAX_RLM_WALL_MS_PER_TURN, "wall capacity must be reserved once")
})

Deno.test("overlapping same-session lookups serialize but different sessions remain independent", async () => {
  const governor = new TurnGovernor()
  let releaseOld!: () => void
  let oldStartedResolve!: () => void
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve })
  const oldStarted = new Promise<void>((resolve) => { oldStartedResolve = resolve })
  let calls = 0
  const sdk = client(async () => {
    calls++
    if (calls === 1) {
      oldStartedResolve()
      await oldGate
      return turnMessages("user-old", "assistant-old")
    }
    return { data: [
      { info: { id: "user-old", role: "user" } },
      { info: { id: "assistant-old", role: "assistant" } },
      { info: { id: "user-new", role: "user" } },
      { info: { id: "assistant-new", role: "assistant" } },
    ] }
  })
  const older = governor.beginExec(sdk, "session-1", "/workspace", "assistant-old")
  await oldStarted
  const newer = governor.beginExec(sdk, "session-1", "/workspace", "assistant-new")
  await Promise.resolve()
  assert(calls === 1, "same-session lookup should wait")

  const other = await governor.beginExec(client(() => turnMessages("user-b", "assistant-b")), "session-b", "/workspace", "assistant-b")
  assert(other.snapshot.turnId === "user-b", "different session must remain independent")
  releaseOld()
  const results = await Promise.all([older, newer])
  assert(results[1].snapshot.turnId === "user-new", "newer turn should finish authoritative")
})
