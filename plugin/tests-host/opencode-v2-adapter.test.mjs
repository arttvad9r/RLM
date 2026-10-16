import assert from "node:assert/strict"
import test from "node:test"

import { createOpenCodeV2RlmClient } from "../rlm-lib/opencode-v2.ts"
import plugin from "../rlm.ts"

function baseContext(overrides = {}) {
  const registration = { dispose: async () => {} }
  return {
    location: { directory: "/repo", project: { canonical: "/repo" } },
    session: {
      context: async () => [],
      create: async () => ({ id: "child-1" }),
      interrupt: async () => {},
      prompt: async () => ({ id: "child-user-1" }),
      wait: async () => {},
      hook: async () => registration,
      ...overrides.session,
    },
    tool: {
      list: async () => [],
      transform: async (apply) => {
        apply({ add: () => {} })
        return registration
      },
      ...overrides.tool,
    },
    event: {
      subscribe: async function* () {},
      ...overrides.event,
    },
  }
}

test("OpenCode V2 adapter maps assistant model identity and child creation", async () => {
  let createInput
  const ctx = baseContext({
    session: {
      context: async () => [
        { type: "user", id: "user-1" },
        {
          type: "assistant",
          id: "assistant-1",
          model: { providerID: "openai", id: "gpt-test" },
          content: [],
        },
      ],
      create: async (input) => {
        createInput = input
        return { id: "child-1" }
      },
    },
  })
  const client = createOpenCodeV2RlmClient(ctx)

  const messages = await client.session.messages({
    path: { id: "root" },
    query: { directory: "/repo" },
  })
  assert.deepEqual(messages, {
    data: [
      { info: { id: "user-1", role: "user" } },
      {
        info: {
          id: "assistant-1",
          role: "assistant",
          model: { providerID: "openai", modelID: "gpt-test" },
        },
      },
    ],
  })

  const created = await client.session.create({
    body: {
      parentID: "root",
      title: "rlm child",
      model: { providerID: "openai", modelID: "gpt-test" },
    },
    query: { directory: "/repo" },
  })
  assert.deepEqual(created, { data: { id: "child-1" } })
  assert.deepEqual(createInput, {
    parentID: "root",
    title: "rlm child",
    model: { providerID: "openai", id: "gpt-test" },
    location: { directory: "/repo" },
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  })
})

test("OpenCode V2 adapter waits for the child response, extracts text, aborts, and lists tools", async () => {
  const calls = []
  const ctx = baseContext({
    session: {
      prompt: async (input) => {
        calls.push(["prompt", input])
        return { id: "child-user-1" }
      },
      wait: async (input) => {
        calls.push(["wait", input])
      },
      context: async (input) => {
        calls.push(["context", input])
        return [
          { type: "user", id: "child-user-1" },
          {
            type: "assistant",
            id: "child-assistant-1",
            model: { providerID: "openai", id: "gpt-test" },
            finish: "stop",
            cost: 0.125,
            tokens: { input: 11, output: 5, cache: { read: 2, write: 0 } },
            content: [{ type: "text", text: "CHILD_OK" }],
          },
        ]
      },
      interrupt: async (input) => {
        calls.push(["interrupt", input])
      },
    },
    tool: {
      list: async () => [{ id: "read" }, { id: "bash" }, { id: "rlm_exec" }],
    },
  })
  const client = createOpenCodeV2RlmClient(ctx)

  const result = await client.session.prompt({
    path: { id: "child-1" },
    body: {
      parts: [{ type: "text", text: "reply exactly CHILD_OK" }],
      model: { providerID: "openai", modelID: "gpt-test" },
      tools: { read: false, bash: false, rlm_exec: false },
    },
    query: { directory: "/repo" },
  })
  assert.deepEqual(result, {
    data: {
      info: {
        finish: "stop",
        cost: 0.125,
        tokens: { input: 11, output: 5, cache: { read: 2, write: 0 } },
        error: undefined,
      },
      parts: [{ type: "text", text: "CHILD_OK" }],
    },
  })
  assert.deepEqual(calls.slice(0, 3), [
    ["prompt", { sessionID: "child-1", text: "reply exactly CHILD_OK" }],
    ["wait", { sessionID: "child-1" }],
    ["context", { sessionID: "child-1" }],
  ])

  const tools = await client.tool.ids({ query: { directory: "/repo" } })
  assert.deepEqual(tools, { data: ["read", "bash", "rlm_exec"] })

  const aborted = await client.session.abort({
    path: { id: "child-1" },
    query: { directory: "/repo" },
  })
  assert.deepEqual(aborted, {})
  assert.deepEqual(calls.at(-1), ["interrupt", { sessionID: "child-1" }])
})

test("OpenCode V2 plugin registers rlm_exec and disposes registrations", async () => {
  let toolInfo
  let contextHook
  let toolDisposed = 0
  let contextDisposed = 0
  const ctx = baseContext({
    session: {
      hook: async (name, handler) => {
        assert.equal(name, "context")
        contextHook = handler
        return { dispose: async () => { contextDisposed++ } }
      },
    },
    tool: {
      transform: async (apply) => {
        apply({ add: (info) => { toolInfo = info } })
        return { dispose: async () => { toolDisposed++ } }
      },
    },
  })

  const cleanup = await plugin.setup(ctx)
  assert.equal(typeof contextHook, "function")
  assert.equal(toolInfo?.name, "rlm_exec")
  assert.equal(toolInfo?.input?.type, "object")
  assert.deepEqual(toolInfo?.input?.required, ["code"])
  assert.equal(typeof toolInfo?.execute, "function")

  await cleanup?.()
  assert.equal(toolDisposed, 1)
  assert.equal(contextDisposed, 1)
})
