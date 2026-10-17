import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { executeContextOperation } from "../rlm-lib/context.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { RlmRunState } from "../rlm-lib/types.ts"

async function withStandalonePolicy(run) {
  const previousConfig = process.env.XDG_CONFIG_HOME
  const previousPolicy = process.env.RLM_CONTEXT_POLICY
  try {
    delete process.env.XDG_CONFIG_HOME
    delete process.env.RLM_CONTEXT_POLICY
    return await run()
  } finally {
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousConfig
    if (previousPolicy === undefined) delete process.env.RLM_CONTEXT_POLICY
    else process.env.RLM_CONTEXT_POLICY = previousPolicy
  }
}

test("pre-aborted rlm_exec rejects host context work before filesystem traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-context-abort-"))
  try {
    const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
    state.abort.abort()
    await withStandalonePolicy(async () => {
      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "aborted-files",
          operation: "files",
          query: "",
        }),
        (error) => error instanceof RlmError
          && error.code === "RUNTIME_ERROR"
          && /context operation aborted/.test(error.message),
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("expired rlm_exec deadline rejects host reads with TIMEOUT", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-context-deadline-"))
  try {
    await writeFile(path.join(root, "a.txt"), "must not be returned")
    const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await withStandalonePolicy(async () => {
      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "expired-read",
          operation: "read",
          path: "a.txt",
        }),
        (error) => error instanceof RlmError
          && error.code === "TIMEOUT"
          && /context operation exceeded the rlm_exec deadline/.test(error.message),
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
