import assert from "node:assert/strict"
import test from "node:test"

import { callChildLlm } from "../rlm-lib/child.ts"
import { activeRlmChildCount } from "../rlm-lib/child-system.ts"
import { RlmError } from "../rlm-lib/errors.ts"

const log = async () => {}
const NEVER = () => new Promise(() => {})

function baseClient(overrides = {}) {
  const aborts = []
  let creates = 0
  let prompts = 0
  const client = {
    session: {
      messages: async () => ({
        data: [{ info: { id: "user-1", role: "user", model: { providerID: "p", modelID: "m" } } }],
      }),
      create: async () => {
        creates++
        return { data: { id: "child-1" } }
      },
      abort: async ({ path }) => {
        aborts.push(path.id)
      },
      prompt: async () => {
        prompts++
        return { data: { info: { finish: "stop" }, parts: [{ type: "text", text: "ok" }] } }
      },
      ...overrides.session,
    },
    tool: {
      ids: async () => ({ data: ["read"] }),
      ...overrides.tool,
    },
  }
  return { client, aborts, counts: () => ({ creates, prompts }) }
}

async function expectAbortSettles(stage, overrides) {
  const { client } = baseClient(overrides)
  const controller = new AbortController()
  const call = callChildLlm(client, {
    prompt: "work",
    parentSessionID: "root",
    parentUserMessageID: "user-1",
    directory: "/workspace",
    signal: controller.signal,
  }, log)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  const outcome = await Promise.race([
    call.then(() => ({ ok: true }), (error) => ({ error })),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 100)),
  ])
  assert.equal(outcome.timeout, undefined, `${stage} remained pending after parent abort`)
  assert.ok(outcome.error instanceof RlmError)
  assert.equal(outcome.error.code, "CHILD_FAILED")
  assert.match(outcome.error.message, /parent aborted/)
  assert.equal(activeRlmChildCount(), 0)
}

test("parent abort settles all child SDK stages even when provider promises hang", async () => {
  await expectAbortSettles("messages", { session: { messages: NEVER } })
  await expectAbortSettles("tool.ids", { tool: { ids: NEVER } })
  await expectAbortSettles("session.create", { session: { create: NEVER } })

  let started
  const promptStarted = new Promise((resolve) => { started = resolve })
  const fixture = baseClient({ session: { prompt: async () => { started(); return await NEVER() } } })
  const controller = new AbortController()
  const call = callChildLlm(fixture.client, {
    prompt: "work",
    parentSessionID: "root",
    parentUserMessageID: "user-1",
    directory: "/workspace",
    signal: controller.signal,
  }, log)
  await promptStarted
  assert.equal(activeRlmChildCount(), 1)
  controller.abort()
  await assert.rejects(call, (error) => error instanceof RlmError && error.code === "CHILD_FAILED")
  assert.deepEqual(fixture.aborts, ["child-1"])
  assert.equal(activeRlmChildCount(), 0)
})

test("a child created after local abort is provider-aborted instead of orphaned", async () => {
  let resolveCreate
  const create = new Promise((resolve) => { resolveCreate = resolve })
  const fixture = baseClient({ session: { create: () => create } })
  const controller = new AbortController()
  const call = callChildLlm(fixture.client, {
    prompt: "work",
    parentSessionID: "root",
    parentUserMessageID: "user-1",
    directory: "/workspace",
    signal: controller.signal,
  }, log)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(call, (error) => error instanceof RlmError && error.code === "CHILD_FAILED")
  resolveCreate({ data: { id: "late-child" } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(fixture.aborts, ["late-child"])
  assert.equal(activeRlmChildCount(), 0)
})

test("child rejects malformed tool inventory before child creation", async () => {
  for (const inventory of ["bash", ["read", 7], ["read", ""]]) {
    const fixture = baseClient({ tool: { ids: async () => ({ data: inventory }) } })
    await assert.rejects(
      () => callChildLlm(fixture.client, {
        prompt: "x",
        parentSessionID: "root",
        parentUserMessageID: "user-1",
        directory: "/workspace",
      }, log),
      (error) => error instanceof RlmError
        && error.code === "CHILD_FAILED"
        && /tool\.ids\(\) returned an invalid/.test(error.message),
    )
    assert.deepEqual(fixture.counts(), { creates: 0, prompts: 0 })
  }

  const sparse = new Array(2)
  sparse[0] = "read"
  const fixture = baseClient({ tool: { ids: async () => ({ data: sparse }) } })
  await assert.rejects(
    () => callChildLlm(fixture.client, {
      prompt: "x",
      parentSessionID: "root",
      parentUserMessageID: "user-1",
      directory: "/workspace",
    }, log),
    /invalid tool id at index 1/,
  )
  assert.deepEqual(fixture.counts(), { creates: 0, prompts: 0 })
})

test("pre-aborted parent fails immediately without starting SDK preflight", async () => {
  let messageCalls = 0
  const fixture = baseClient({
    session: {
      messages: () => {
        messageCalls++
        return NEVER()
      },
    },
  })
  const controller = new AbortController()
  controller.abort()

  const outcome = await Promise.race([
    callChildLlm(fixture.client, {
      prompt: "x",
      parentSessionID: "root",
      parentUserMessageID: "user-1",
      directory: "/workspace",
      signal: controller.signal,
    }, log).then(() => "resolved", (error) => error),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
  ])

  assert.notEqual(outcome, "timeout")
  assert.ok(outcome instanceof RlmError)
  assert.equal(outcome.code, "CHILD_FAILED")
  assert.match(outcome.message, /parent aborted before child setup/)
  assert.equal(messageCalls, 0)
  assert.deepEqual(fixture.counts(), { creates: 0, prompts: 0 })
  assert.deepEqual(fixture.aborts, [])
  assert.equal(activeRlmChildCount(), 0)
})

test("preflight SDK throws and promise rejections normalize to CHILD_FAILED", async () => {
  const fixtures = [
    baseClient({ session: { messages: () => { throw new Error("sync messages") } } }),
    baseClient({ session: { messages: async () => { throw new Error("async messages") } } }),
    baseClient({ tool: { ids: () => { throw new Error("sync ids") } } }),
    baseClient({ tool: { ids: async () => { throw new Error("async ids") } } }),
    baseClient({ session: { create: () => { throw new Error("sync create") } } }),
    baseClient({ session: { create: async () => { throw new Error("async create") } } }),
  ]

  for (const fixture of fixtures) {
    await assert.rejects(
      () => callChildLlm(fixture.client, {
        prompt: "x",
        parentSessionID: "root",
        parentUserMessageID: "user-1",
        directory: "/workspace",
      }, log),
      (error) => error instanceof RlmError && error.code === "CHILD_FAILED",
    )
  }
})

test("synchronous provider abort failure cannot prevent local cancellation", async () => {
  const controller = new AbortController()
  const fixture = baseClient({
    session: {
      abort: () => { throw new Error("sync provider abort failure") },
      prompt: NEVER,
    },
  })
  const call = callChildLlm(fixture.client, {
    prompt: "x",
    parentSessionID: "root",
    parentUserMessageID: "user-1",
    directory: "/workspace",
    signal: controller.signal,
  }, log)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()

  const outcome = await Promise.race([
    call.then(() => "resolved", (error) => error),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
  ])
  assert.notEqual(outcome, "timeout")
  assert.ok(outcome instanceof RlmError)
  assert.equal(outcome.code, "CHILD_FAILED")
  assert.equal(activeRlmChildCount(), 0)
})

test("child lifecycle does not depend on logger settlement", async () => {
  const fixture = baseClient()
  const neverLog = async () => await NEVER()
  const outcome = await Promise.race([
    callChildLlm(fixture.client, {
      prompt: "x",
      parentSessionID: "root",
      parentUserMessageID: "user-1",
      directory: "/workspace",
    }, neverLog).then((result) => result.text),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
  ])
  assert.equal(outcome, "ok")
})

test("child rejects malformed SDK response shapes without raw TypeError", async () => {
  for (const data of ["not-an-array", [null], [undefined], [{}], [{ info: null }], ["bad"]]) {
    const fixture = baseClient({ session: { messages: async () => ({ data }) } })
    await assert.rejects(
      () => callChildLlm(fixture.client, {
        prompt: "x",
        parentSessionID: "root",
        parentUserMessageID: "user-1",
        directory: "/workspace",
      }, log),
      (error) => error instanceof RlmError && error.code === "CHILD_FAILED",
    )
  }

  for (const data of [{ id: "" }, { id: 7 }, {}, null]) {
    const fixture = baseClient({ session: { create: async () => ({ data }) } })
    await assert.rejects(
      () => callChildLlm(fixture.client, {
        prompt: "x",
        parentSessionID: "root",
        parentUserMessageID: "user-1",
        directory: "/workspace",
      }, log),
      (error) => error instanceof RlmError
        && error.code === "CHILD_FAILED"
        && /failed to create child session/.test(error.message),
    )
    assert.equal(activeRlmChildCount(), 0)
  }

  const malformedPrompt = baseClient({ session: { prompt: async () => null } })
  await assert.rejects(
    () => callChildLlm(malformedPrompt.client, {
      prompt: "x",
      parentSessionID: "root",
      parentUserMessageID: "user-1",
      directory: "/workspace",
    }, log),
    (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /invalid response object/.test(error.message),
  )
  assert.equal(activeRlmChildCount(), 0)
})

test("opaque SDK error envelopes fail closed without serialization crashes or secret dumping", async () => {
  const cyclic = {}
  cyclic.self = cyclic
  const secret = "Bearer must-not-leak"
  const fixtures = [
    baseClient({ session: { messages: async () => ({ error: cyclic }) } }),
    baseClient({ tool: { ids: async () => ({ error: { value: 1n, authorization: secret } }) } }),
    baseClient({ session: { create: async () => ({ error: { nested: cyclic, authorization: secret } }) } }),
    baseClient({ session: { prompt: async () => ({ error: { nested: cyclic, authorization: secret } }) } }),
  ]

  for (const fixture of fixtures) {
    let failure
    try {
      await callChildLlm(fixture.client, {
        prompt: "x",
        parentSessionID: "root",
        parentUserMessageID: "user-1",
        directory: "/workspace",
      }, log)
      assert.fail("expected child failure")
    } catch (error) {
      failure = error
    }
    assert.ok(failure instanceof RlmError)
    assert.equal(failure.code, "CHILD_FAILED")
    assert.doesNotMatch(failure.message, /must-not-leak/)
    assert.equal(activeRlmChildCount(), 0)
  }
})
