import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  MAX_CONTEXT_PATH_CHARS,
  MAX_FILES_QUERY_CHARS,
  MAX_GREP_PATTERN_CHARS,
} from "../rlm-lib/constants.ts"
import { executeContextOperation } from "../rlm-lib/context.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { RlmRunState } from "../rlm-lib/types.ts"

async function withIsolatedContext(run) {
  const config = await mkdtemp(path.join(tmpdir(), "rlm-context-budget-config-"))
  const root = await mkdtemp(path.join(tmpdir(), "rlm-context-budget-root-"))
  const previousConfig = process.env.XDG_CONFIG_HOME
  const previousPolicy = process.env.OPENCODE_RLM_CONTEXT_POLICY
  try {
    process.env.XDG_CONFIG_HOME = config
    delete process.env.OPENCODE_RLM_CONTEXT_POLICY
    return await run(root)
  } finally {
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousConfig
    if (previousPolicy === undefined) delete process.env.OPENCODE_RLM_CONTEXT_POLICY
    else process.env.OPENCODE_RLM_CONTEXT_POLICY = previousPolicy
    await rm(config, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
}

function stateFor(root) {
  return new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 5_000 })
}

const client = { file: {} }

test("readMany fails before materializing a multi-megabyte result", async () => {
  await withIsolatedContext(async (root) => {
    const paths = []
    for (let index = 0; index < 10; index++) {
      const name = `large-${index}.txt`
      paths.push(name)
      await writeFile(path.join(root, name), "x".repeat(120_000))
    }
    await assert.rejects(
      () => executeContextOperation(client, stateFor(root), root, {
        v: 1,
        type: "context",
        id: "large-read-many",
        operation: "readMany",
        paths,
      }),
      (error) => error instanceof RlmError
        && error.code === "BUDGET_EXCEEDED"
        && /context\.readMany: result exceeds/.test(error.message),
    )
  })
})

test("host context rejects oversized path, grep pattern and files query arguments", async () => {
  await withIsolatedContext(async (root) => {
    const cases = [
      {
        message: {
          v: 1, type: "context", id: "path", operation: "read",
          path: "x".repeat(MAX_CONTEXT_PATH_CHARS + 1),
        },
        expected: /context\.read: path exceeds/,
      },
      {
        message: {
          v: 1, type: "context", id: "grep", operation: "grep",
          pattern: "x".repeat(MAX_GREP_PATTERN_CHARS + 1),
        },
        expected: /context\.grep: pattern exceeds/,
      },
      {
        message: {
          v: 1, type: "context", id: "files", operation: "files",
          query: "x".repeat(MAX_FILES_QUERY_CHARS + 1),
        },
        expected: /context\.files: query exceeds/,
      },
    ]
    for (const item of cases) {
      await assert.rejects(
        () => executeContextOperation(client, stateFor(root), root, item.message),
        (error) => error instanceof RlmError
          && error.code === "BUDGET_EXCEEDED"
          && item.expected.test(error.message),
      )
    }
  })
})
