import { callChildLlm } from "../rlm-lib/child.ts"
import { RlmError } from "../rlm-lib/errors.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test("child fails closed when tool inventory is empty", async () => {
  let createCalled = false
  const client = {
    session: {
      messages: async () => ({
        data: [{ info: { role: "user", model: { providerID: "provider", modelID: "model" } } }],
      }),
      create: async () => {
        createCalled = true
        return { data: { id: "child" } }
      },
      abort: async () => ({}),
      prompt: async () => ({ data: { parts: [{ type: "text", text: "unexpected" }] } }),
    },
    tool: {
      ids: async () => ({ data: [] }),
    },
  }

  let thrown: unknown
  try {
    await callChildLlm(
      client,
      { prompt: "classify", parentSessionID: "parent", directory: "/project" },
      async () => {},
    )
  } catch (error) {
    thrown = error
  }

  assert(thrown instanceof RlmError, "expected RlmError")
  assert(thrown.code === "CHILD_FAILED", `expected CHILD_FAILED, got ${thrown.code}`)
  assert(thrown.message.includes("empty list"), `unexpected diagnostic: ${thrown.message}`)
  assert(!createCalled, "child session must not be created without a complete deny map")
})

Deno.test("child prompt uses only the provider/model fields supported by pinned SDK", async () => {
  let body: Record<string, unknown> | undefined
  const client = {
    session: {
      messages: async () => ({
        data: [{ info: { role: "user", model: { providerID: "provider", modelID: "model" } } }],
      }),
      create: async () => ({ data: { id: "child" } }),
      abort: async () => ({}),
      prompt: async (args: { body: Record<string, unknown> }) => {
        body = args.body
        return {
          data: {
            info: { finish: "stop", cost: 0, tokens: { input: 1, output: 1 } },
            parts: [{ type: "text", text: "answer" }],
          },
        }
      },
    },
    tool: { ids: async () => ({ data: ["read"] }) },
  }

  const result = await callChildLlm(
    client,
    { prompt: "classify", parentSessionID: "parent", directory: "/project" },
    async () => {},
  )
  assert(JSON.stringify(body?.model) === JSON.stringify({ providerID: "provider", modelID: "model" }), "unexpected child model body")
  assert(body !== undefined && !("variant" in body), "pinned SDK prompt body must not receive variant")
  assert(result.model === "provider/model", "expected inherited provider/model")
  assert(!("variant" in result), "child result must not claim unsupported variant inheritance")
})
