import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { executeContextOperation } from "../rlm-lib/context.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { RlmRunState } from "../rlm-lib/types.ts"

async function withoutContextAuthorityEnv(run) {
  const keys = ["XDG_CONFIG_HOME", "RLM_CONTEXT_ROOT", "RLM_CONTEXT_POLICY"]
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  try {
    for (const key of keys) delete process.env[key]
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("context grep skips approved non-text files and still returns text matches", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-grep-nontext-"))
  try {
    await writeFile(path.join(root, "a.ts"), "const needle = true\n")
    await writeFile(path.join(root, "asset.bin"), Buffer.from([0, 110, 101, 101, 100, 108, 101, 0]))
    await writeFile(path.join(root, "image.png"), Buffer.alloc(160 * 1024, 0))
    await writeFile(path.join(root, "mystery.raw"), Buffer.from([0xff, 0xfe, 0xfd]))

    await withoutContextAuthorityEnv(async () => {
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1000 })
      const result = await executeContextOperation(state, {
        v: 1,
        type: "context",
        id: "grep-nontext",
        operation: "grep",
        pattern: "needle",
      })
      assert.deepEqual(result.value, [{ path: "a.ts", line: 1, text: "const needle = true" }])

      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "read-binary",
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

test("context grep still fails closed when an unclassified text file exceeds the read bound", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-grep-oversized-"))
  try {
    await writeFile(path.join(root, "a.ts"), "needle\n")
    await writeFile(path.join(root, "huge.txt"), "x".repeat(128 * 1024 + 1))

    await withoutContextAuthorityEnv(async () => {
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1000 })
      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "grep-oversized",
          operation: "grep",
          pattern: "needle",
        }),
        (error) => error instanceof RlmError
          && error.code === "BUDGET_EXCEEDED"
          && /exceeds the approved limit/.test(error.message),
      )
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
