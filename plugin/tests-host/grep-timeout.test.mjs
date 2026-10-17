import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { executeContextOperation } from "../rlm-lib/context.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { RlmRunState } from "../rlm-lib/types.ts"

function clientFor(root) {
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

test("context grep preempts catastrophic regular-expression backtracking", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-grep-timeout-"))
  const config = await mkdtemp(path.join(tmpdir(), "rlm-grep-timeout-config-"))
  const previousConfig = process.env.XDG_CONFIG_HOME
  const previousPolicy = process.env.RLM_CONTEXT_POLICY
  try {
    process.env.XDG_CONFIG_HOME = config
    delete process.env.RLM_CONTEXT_POLICY
    await writeFile(path.join(root, "bad.txt"), `${"a".repeat(100_000)}!`)
    const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 5_000 })
    const started = Date.now()
    await assert.rejects(
      () => executeContextOperation(state, {
        v: 1,
        type: "context",
        id: "catastrophic-regex",
        operation: "grep",
        pattern: "^(a+)+$",
      }),
      (error) => error instanceof RlmError && error.code === "TIMEOUT" && /regular expression evaluation/.test(error.message),
    )
    assert.ok(Date.now() - started < 3_000, "catastrophic regex must be preempted instead of blocking the host")
  } finally {
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousConfig
    if (previousPolicy === undefined) delete process.env.RLM_CONTEXT_POLICY
    else process.env.RLM_CONTEXT_POLICY = previousPolicy
    await rm(root, { recursive: true, force: true })
    await rm(config, { recursive: true, force: true })
  }
})
