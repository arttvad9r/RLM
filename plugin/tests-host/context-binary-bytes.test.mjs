import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { executeContextOperation } from "../rlm-lib/context.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { RlmRunState } from "../rlm-lib/types.ts"

const client = { file: {} }

async function withConfig(run) {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-binary-bytes-"))
  const config = await mkdtemp(path.join(tmpdir(), "rlm-binary-config-"))
  const previous = process.env.XDG_CONFIG_HOME
  try {
    process.env.XDG_CONFIG_HOME = config
    await run(root)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    await rm(root, { recursive: true, force: true })
    await rm(config, { recursive: true, force: true })
  }
}

for (const [name, bytes, diagnostic] of [
  ["NUL bytes", Buffer.from([0x61, 0x00, 0x62]), /binary\/NUL/],
  ["invalid UTF-8", Buffer.from([0xc3, 0x28]), /non-UTF-8/],
]) {
  test(`context read rejects ${name}`, async () => {
    await withConfig(async (root) => {
      await writeFile(path.join(root, "payload.txt"), bytes)
      const state = new RlmRunState({ workspaceRoot: root, broadWorkspaceRoot: false, timeoutMs: 1_000 })
      await assert.rejects(
        () => executeContextOperation(state, {
          v: 1,
          type: "context",
          id: "binary-bytes",
          operation: "read",
          path: "payload.txt",
        }),
        (error) => error instanceof RlmError && error.code === "READ_FAILED" && diagnostic.test(error.message),
      )
    })
  })
}
