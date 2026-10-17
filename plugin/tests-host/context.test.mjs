import assert from "node:assert/strict"
import test from "node:test"
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { executeContextOperation } from "../rlm-lib/context.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { RlmRunState } from "../rlm-lib/types.ts"

function filesystemClient(root) {
  return {
    file: {
      read: async ({ query }) => ({ data: { content: await readFile(path.resolve(query.directory, query.path), "utf8") } }),
      list: async ({ query }) => {
        const directory = path.resolve(query.directory, query.path === "." ? "" : query.path)
        const entries = await readdir(directory, { withFileTypes: true })
        return {
          data: entries.map((entry) => ({
            type: entry.isDirectory() ? "directory" : "file",
            name: entry.name,
            path: path.relative(root, path.join(directory, entry.name)).split(path.sep).join("/"),
          })),
        }
      },
    },
  }
}

function forbiddenFileClient() {
  return {
    file: {
      read: async () => { throw new Error("OpenCode file.read must not be used by RLM context I/O") },
      list: async () => { throw new Error("OpenCode file.list must not be used by RLM context I/O") },
    },
  }
}

async function withContextPolicy(policy, run) {
  const config = await mkdtemp(path.join(tmpdir(), "rlm-host-context-config-"))
  const previousConfig = process.env.XDG_CONFIG_HOME
  const previousPolicy = process.env.RLM_CONTEXT_POLICY
  try {
    process.env.XDG_CONFIG_HOME = config
    process.env.RLM_CONTEXT_POLICY = JSON.stringify(policy)
    return await run()
  } finally {
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousConfig
    if (previousPolicy === undefined) delete process.env.RLM_CONTEXT_POLICY
    else process.env.RLM_CONTEXT_POLICY = previousPolicy
    await rm(config, { recursive: true, force: true })
  }
}

test("context read uses bounded host filesystem I/O and preserves whole-file whitespace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-host-context-raw-"))
  try {
    const expected = "\n  exact text  \n\n"
    await writeFile(path.join(root, "nested.txt"), expected)
    await withContextPolicy({}, async () => {
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
      const result = await executeContextOperation(state, {
        v: 1,
        type: "context",
        id: "raw-read",
        operation: "read",
        path: "nested.txt",
      })
      assert.equal(result.value, expected)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("context read rejects known binary files without consulting OpenCode file API", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-host-context-binary-"))
  try {
    await writeFile(path.join(root, "asset.bin"), "ASCII-looking binary placeholder")
    await withContextPolicy({}, async () => {
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "binary",
          operation: "read",
          path: "asset.bin",
        }),
        (error) => error instanceof RlmError
          && error.code === "READ_FAILED"
          && /binary file extension/.test(error.message),
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("context grep scans only approved files without any repository-wide search capability", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-host-context-grep-"))
  try {
    await mkdir(path.join(root, "allowed"))
    await mkdir(path.join(root, "outside"))
    await writeFile(path.join(root, "allowed", "a.ts"), "const needle = true\n")
    await writeFile(path.join(root, "outside", "secret.ts"), "const needle = 'secret'\n")
    await withContextPolicy({ allowed_paths: ["allowed"] }, async () => {
      const client = filesystemClient(root)
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
      const result = await executeContextOperation(state, {
        v: 1,
        type: "context",
        id: "grep-scope",
        operation: "grep",
        pattern: "needle",
      })
      assert.deepEqual(result.value, [{ path: "allowed/a.ts", line: 1, text: "const needle = true" }])
      assert.equal("search" in client, false)
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("context read limit is measured in UTF-8 bytes rather than JavaScript characters", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-host-context-bytes-"))
  try {
    await writeFile(path.join(root, "unicode.txt"), "ééé")
    await withContextPolicy({ max_read_bytes: 4 }, async () => {
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "utf8-bytes",
          operation: "read",
          path: "unicode.txt",
        }),
        (error) => error instanceof RlmError
          && error.code === "BUDGET_EXCEEDED"
          && /6 bytes/.test(error.message),
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("readMany preserves per-file failures without widening filesystem authority", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-host-context-many-"))
  try {
    await writeFile(path.join(root, "ok.txt"), "ok")
    await withContextPolicy({}, async () => {
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
      const result = await executeContextOperation(state, {
        v: 1,
        type: "context",
        id: "read-many",
        operation: "readMany",
        paths: ["ok.txt", "missing.txt", "../escape.txt"],
      })
      const items = result.value
      assert.equal(Array.isArray(items), true)
      assert.equal(items[0].content, "ok")
      assert.equal(items[1].error.code, "READ_FAILED")
      assert.equal(items[2].error.code, "CONTEXT_DENIED")
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("symlink reads that resolve outside the workspace fail closed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-host-context-link-"))
  const outside = await mkdtemp(path.join(tmpdir(), "rlm-host-context-outside-"))
  try {
    await writeFile(path.join(outside, "secret.txt"), "secret")
    await symlink(path.join(outside, "secret.txt"), path.join(root, "secret-link.txt"))
    await withContextPolicy({}, async () => {
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "symlink",
          operation: "read",
          path: "secret-link.txt",
        }),
        (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED",
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test("context files fails closed instead of returning a depth-truncated listing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-host-context-depth-"))
  try {
    let current = root
    for (let depth = 1; depth <= 13; depth++) {
      current = path.join(current, `d${depth}`)
      await mkdir(current)
    }
    await writeFile(path.join(current, "deep.txt"), "deep")
    await withContextPolicy({}, async () => {
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "depth",
          operation: "files",
          query: "",
        }),
        (error) => error instanceof RlmError
          && error.code === "BUDGET_EXCEEDED"
          && /directory depth/.test(error.message)
          && /full result cannot be returned/.test(error.message),
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
