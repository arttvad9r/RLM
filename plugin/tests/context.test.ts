import { executeContextOperation } from "../rlm-lib/context.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { RlmRunState } from "../rlm-lib/types.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function forbiddenFileClient() {
  return {
    file: {
      read: async () => { throw new Error("OpenCode file.read must not be used by RLM context I/O") },
      list: async () => { throw new Error("OpenCode file.list must not be used by RLM context I/O") },
    },
  }
}

Deno.test("context.files is rooted at approved host workspace, not session directory", async () => {
  const previousPolicy = Deno.env.get("RLM_CONTEXT_POLICY")
  const previousConfig = Deno.env.get("XDG_CONFIG_HOME")
  const root = await Deno.makeTempDir({ prefix: "rlm-approved-" })
  const config = await Deno.makeTempDir({ prefix: "rlm-approved-config-" })
  await Deno.writeTextFile(`${root}/ok.ts`, "ok\n")
  try {
    Deno.env.set("XDG_CONFIG_HOME", config)
    Deno.env.delete("RLM_CONTEXT_POLICY")
    const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
    const result = await executeContextOperation(state, {
      v: 1,
      type: "context",
      id: "rooted",
      operation: "files",
      query: "",
    })
    assert(JSON.stringify(result.value) === JSON.stringify(["ok.ts"]), "expected approved workspace file")
  } finally {
    if (previousPolicy === undefined) Deno.env.delete("RLM_CONTEXT_POLICY")
    else Deno.env.set("RLM_CONTEXT_POLICY", previousPolicy)
    if (previousConfig === undefined) Deno.env.delete("XDG_CONFIG_HOME")
    else Deno.env.set("XDG_CONFIG_HOME", previousConfig)
    await Deno.remove(root, { recursive: true })
    await Deno.remove(config, { recursive: true })
  }
})

Deno.test("context.grep scans only host-approved files through bounded host I/O", async () => {
  const previousPolicy = Deno.env.get("RLM_CONTEXT_POLICY")
  const previousConfig = Deno.env.get("XDG_CONFIG_HOME")
  const root = await Deno.makeTempDir({ prefix: "rlm-grep-root-" })
  const config = await Deno.makeTempDir({ prefix: "rlm-grep-config-" })
  await Deno.mkdir(`${root}/allowed`)
  await Deno.mkdir(`${root}/outside`)
  await Deno.writeTextFile(`${root}/allowed/a.ts`, "const needle = true\n")
  await Deno.writeTextFile(`${root}/outside/secret.ts`, "const needle = 'secret'\n")

  try {
    Deno.env.set("XDG_CONFIG_HOME", config)
    Deno.env.set("RLM_CONTEXT_POLICY", JSON.stringify({ allowed_paths: ["allowed"] }))
    const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
    const result = await executeContextOperation(state, {
      v: 1,
      type: "context",
      id: "grep-scope",
      operation: "grep",
      pattern: "needle",
    })
    assert(JSON.stringify(result.value) === JSON.stringify([{ path: "allowed/a.ts", line: 1, text: "const needle = true" }]), "expected only approved match")
  } finally {
    if (previousPolicy === undefined) Deno.env.delete("RLM_CONTEXT_POLICY")
    else Deno.env.set("RLM_CONTEXT_POLICY", previousPolicy)
    if (previousConfig === undefined) Deno.env.delete("XDG_CONFIG_HOME")
    else Deno.env.set("XDG_CONFIG_HOME", previousConfig)
    await Deno.remove(root, { recursive: true })
    await Deno.remove(config, { recursive: true })
  }
})

Deno.test("context.read rejects known binary files before decoding", async () => {
  const root = await Deno.makeTempDir({ prefix: "rlm-binary-root-" })
  const config = await Deno.makeTempDir({ prefix: "rlm-binary-config-" })
  const previousConfig = Deno.env.get("XDG_CONFIG_HOME")
  await Deno.writeTextFile(`${root}/asset.bin`, "placeholder")
  try {
    Deno.env.set("XDG_CONFIG_HOME", config)
    const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
    try {
      await executeContextOperation(state, {
        v: 1,
        type: "context",
        id: "binary",
        operation: "read",
        path: "asset.bin",
      })
    } catch (error) {
      assert(error instanceof RlmError, `expected RlmError, got ${String(error)}`)
      assert(error.code === "READ_FAILED", `expected READ_FAILED, got ${error.code}`)
      assert(error.message.includes("binary file extension"), "expected binary diagnostic")
      return
    }
    throw new Error("expected binary read to fail")
  } finally {
    if (previousConfig === undefined) Deno.env.delete("XDG_CONFIG_HOME")
    else Deno.env.set("XDG_CONFIG_HOME", previousConfig)
    await Deno.remove(root, { recursive: true })
    await Deno.remove(config, { recursive: true })
  }
})

Deno.test("context.files fails closed when host traversal depth is incomplete", async () => {
  const previousPolicy = Deno.env.get("RLM_CONTEXT_POLICY")
  const previousConfig = Deno.env.get("XDG_CONFIG_HOME")
  const root = await Deno.makeTempDir({ prefix: "rlm-depth-root-" })
  const config = await Deno.makeTempDir({ prefix: "rlm-depth-config-" })
  let current = root
  for (let depth = 1; depth <= 13; depth++) {
    current = `${current}/d${depth}`
    await Deno.mkdir(current)
  }
  await Deno.writeTextFile(`${current}/deep.txt`, "deep")
  try {
    Deno.env.set("XDG_CONFIG_HOME", config)
    Deno.env.delete("RLM_CONTEXT_POLICY")
    const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
    try {
      await executeContextOperation(state, {
        v: 1,
        type: "context",
        id: "depth",
        operation: "files",
        query: "",
      })
    } catch (error) {
      assert(error instanceof RlmError, `expected RlmError, got ${String(error)}`)
      assert(error.code === "BUDGET_EXCEEDED", `expected BUDGET_EXCEEDED, got ${error.code}`)
      assert(error.message.includes("full result cannot be returned"), "expected explicit incomplete-result diagnostic")
      return
    }
    throw new Error("expected context.files to fail on incomplete traversal")
  } finally {
    if (previousPolicy === undefined) Deno.env.delete("RLM_CONTEXT_POLICY")
    else Deno.env.set("RLM_CONTEXT_POLICY", previousPolicy)
    if (previousConfig === undefined) Deno.env.delete("XDG_CONFIG_HOME")
    else Deno.env.set("XDG_CONFIG_HOME", previousConfig)
    await Deno.remove(root, { recursive: true })
    await Deno.remove(config, { recursive: true })
  }
})
