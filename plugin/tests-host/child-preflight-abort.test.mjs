import assert from "node:assert/strict"
import test from "node:test"

import { callChildLlm } from "../rlm-lib/child.ts"
import { activeRlmChildCount } from "../rlm-lib/child-system.ts"
import { RlmError } from "../rlm-lib/errors.ts"

const log = async () => {}
const NEVER = () => new Promise(() => {})

function baseClient(overrides = {}) {
  const aborts = []
  const client = {
    session: {
      messages: async () => ({ data: [{ info: { id: "user-1", role: "user", model: { providerID: "p", modelID: "m" } } }] }),
      create: async () => ({ data: { id: "child-1" } }),
      abort: async ({ path }) => { aborts.push(path.id) },
      prompt: async () => ({ data: { info: { finish: "stop" }, parts: [{ type: "text", text: "ok" }] } }),
      ...overrides.session,
    },
    tool: {
      ids: async () => ({ data: ["read"] }),
      ...overrides.tool,
    },
  }
  return { client, aborts }
}

async function expectAbortSettles(stage, overrides) {
  const { client } = baseClient(overrides)
  const controller = new AbortController()
  const call = callChildLlm(client, {
    prompt: "work",
    parentSessionID: "root",
    parentTurnID: "user-1",
    directory: "/workspace",
    signal: controller.signal,
  }, log)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  const outcome = await Promise.race([
    call.then(() => ({ ok: true }), (error) => ({ error })),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 75)),
  ])
  assert.equal(outcome.timeout, undefined, `${stage} remained pending after parent abort`)
  assert.ok(outcome.error instanceof RlmError)
  assert.equal(outcome.error.code, "CHILD_FAILED")
  assert.match(outcome.error.message, /parent aborted/)
  assert.equal(activeRlmChildCount(), 0)
}

test("parent abort settles child model lookup even if session.messages never settles", async () => {
  await expectAbortSettles("messages", { session: { messages: NEVER } })
})

test("parent abort settles tool inventory lookup even if tool.ids never settles", async () => {
  await expectAbortSettles("tool.ids", { tool: { ids: NEVER } })
})

test("parent abort settles session.create even if creation never settles", async () => {
  await expectAbortSettles("session.create", { session: { create: NEVER } })
})

test("a child created after local abort is immediately aborted instead of orphaned", async () => {
  let resolveCreate
  const create = new Promise((resolve) => { resolveCreate = resolve })
  const { client, aborts } = baseClient({ session: { create: () => create } })
  const controller = new AbortController()
  const call = callChildLlm(client, {
    prompt: "work",
    parentSessionID: "root",
    parentTurnID: "user-1",
    directory: "/workspace",
    signal: controller.signal,
  }, log)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  await assert.rejects(call, (error) => error instanceof RlmError && error.code === "CHILD_FAILED")
  resolveCreate({ data: { id: "late-child" } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(aborts, ["late-child"])
  assert.equal(activeRlmChildCount(), 0)
})

test("preflight detects an abort fired synchronously by the SDK call before listener registration", async () => {
  const controller = new AbortController()
  const { client } = baseClient({
    session: {
      messages: () => {
        controller.abort()
        return NEVER()
      },
    },
  })
  await assert.rejects(
    () => callChildLlm(client, {
      prompt: "work",
      parentSessionID: "root",
      parentTurnID: "user-1",
      directory: "/workspace",
      signal: controller.signal,
    }, log),
    (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /parent aborted/.test(error.message),
  )
})
