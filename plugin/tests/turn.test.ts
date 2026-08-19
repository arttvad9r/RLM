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

function client(getMessages: () => { error?: unknown; data?: Array<{ info?: { id?: string; role?: string } }> }) {
  return {
    session: {
      messages: async () => getMessages(),
    },
  }
}

Deno.test("turn identity lookup errors fail closed without resetting accumulated budget", async () => {
  const governor = new TurnGovernor()
  let failLookup = false
  const sdk = client(() => failLookup
    ? { error: { code: "transient" } }
    : { data: [{ info: { id: "user-1", role: "user" } }] })

  assert((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, "first exec should start")
  governor.registerChildStart("session-1")
  assert(governor.beginContextCall("session-1"), "first context call should be allowed")
  assert(governor.addContextChars("session-1", 7), "context chars should be counted")
  const before = governor.snapshot("session-1")

  failLookup = true
  try {
    await governor.beginExec(sdk, "session-1", "/workspace", "assistant-2")
  } catch (error) {
    assert(error instanceof RlmError, `expected RlmError, got ${String(error)}`)
    assert(error.code === "RUNTIME_ERROR", `expected RUNTIME_ERROR, got ${error.code}`)
    assert(JSON.stringify(governor.snapshot("session-1")) === JSON.stringify(before), "budget must not reset on lookup failure")
    return
  }
  throw new Error("expected turn lookup failure")
})

Deno.test("missing user message id fails closed", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "assistant-only", role: "assistant" } }] }))
  try {
    await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")
  } catch (error) {
    assert(error instanceof RlmError, `expected RlmError, got ${String(error)}`)
    assert(error.code === "RUNTIME_ERROR", `expected RUNTIME_ERROR, got ${error.code}`)
    assert(error.message.includes("no user message id"), "expected missing-user diagnostic")
    assert(governor.snapshot("session-1")?.execCount === 0, "missing user identity must not consume or reset exec budget")
    return
  }
  throw new Error("expected missing user turn identity failure")
})

Deno.test("uninitialized and invalid turn accounting fail closed", async () => {
  const governor = new TurnGovernor()
  assert(!governor.childAllowed("missing"), "uninitialized child authority must be denied")
  assert(!governor.beginContextCall("missing"), "uninitialized context authority must be denied")
  assert(!governor.addContextChars("missing", 1), "uninitialized context chars must be denied")

  const sdk = client(() => ({ data: [{ info: { id: "user-1", role: "user" } }] }))
  await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")
  governor.reserveExec("session-1", 100)
  governor.finishExec("session-1", 25, 100)
  const before = governor.snapshot("session-1")
  assert(!governor.addContextChars("session-1", -1), "negative context chars must be rejected")
  governor.reserveExec("session-1", -100)
  governor.finishExec("session-1", -100, -100)
  const after = governor.snapshot("session-1")
  assert(after?.wallMsUsed === before?.wallMsUsed, "negative wall accounting must not reduce usage")
  assert(after?.wallMsRemaining === before?.wallMsRemaining, "negative wall accounting must not increase remaining capacity")
})

Deno.test("turn governor enforces exec child context and data budgets", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "user-1", role: "user" } }] }))

  for (let index = 0; index < MAX_RLM_EXECS_PER_TURN; index++) {
    assert((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, `exec ${index + 1} should be allowed`)
  }
  assert(!(await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, "exec limit must fail closed")

  for (let index = 0; index < MAX_CHILD_CALLS_PER_TURN; index++) governor.registerChildStart("session-1")
  assert(!governor.childAllowed("session-1"), "child limit must fail closed")

  for (let index = 0; index < MAX_CONTEXT_CALLS_PER_TURN; index++) {
    assert(governor.beginContextCall("session-1"), `context call ${index + 1} should be allowed`)
  }
  assert(!governor.beginContextCall("session-1"), "context call limit must fail closed")

  assert(governor.addContextChars("session-1", MAX_CONTEXT_CHARS_PER_TURN), "exact context char budget should be allowed")
  assert(!governor.addContextChars("session-1", 1), "context char overflow must fail closed")
})

Deno.test("new user message resets the working turn budget", async () => {
  const governor = new TurnGovernor()
  let userMessageID = "user-1"
  const sdk = client(() => ({ data: [{ info: { id: userMessageID, role: "user" } }] }))

  assert((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, "initial exec should start")
  governor.registerChildStart("session-1")
  governor.beginContextCall("session-1")
  governor.addContextChars("session-1", 11)

  userMessageID = "user-2"
  const next = await governor.beginExec(sdk, "session-1", "/workspace", "assistant-2")
  assert(next.allowed, "new turn should allow exec")
  assert(next.snapshot.turnId === "user-2", "new turn id should be observed")
  assert(next.snapshot.execCount === 1, "new turn starts with one exec")
  assert(next.snapshot.childCallCount === 0, "child budget should reset")
  assert(next.snapshot.contextCallCount === 0, "context call budget should reset")
  assert(next.snapshot.contextCharsSent === 0, "context char budget should reset")
})

Deno.test("wall reservation blocks concurrent exec and is released by finishExec", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "user-1", role: "user" } }] }))

  assert((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, "first exec should start")
  governor.reserveExec("session-1", MAX_RLM_WALL_MS_PER_TURN)
  assert(!(await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, "reservation should block another exec")

  governor.finishExec("session-1", 0, MAX_RLM_WALL_MS_PER_TURN)
  assert((await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1")).allowed, "released reservation should restore wall capacity")
})

Deno.test("beginExec reserves wall atomically across concurrent starts", async () => {
  const governor = new TurnGovernor()
  const sdk = client(() => ({ data: [{ info: { id: "user-1", role: "user" } }] }))
  const [first, second] = await Promise.all([
    governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", MAX_RLM_WALL_MS_PER_TURN),
    governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", MAX_RLM_WALL_MS_PER_TURN),
  ])
  const allowed = [first, second].filter((result) => result.allowed)
  assert(allowed.length === 1, `expected one allowed exec, got ${allowed.length}`)
  assert(first.reservedWallMs + second.reservedWallMs === MAX_RLM_WALL_MS_PER_TURN, "turn wall capacity must be reserved exactly once")
  assert(!(await governor.beginExec(sdk, "session-1", "/workspace", "assistant-1", 1)).allowed, "exhausted reservation must block another exec")
})
