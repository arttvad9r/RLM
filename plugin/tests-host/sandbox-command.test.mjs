import assert from "node:assert/strict"
import test from "node:test"

import { MAX_DENO_OLD_SPACE_MB } from "../rlm-lib/constants.ts"
import { sandboxDenoArgs } from "../rlm-lib/sandbox.ts"

test("trusted Deno runner command has only fixed worker read authority", () => {
  const args = sandboxDenoArgs("/trusted/runner.ts", "/trusted/generated-worker.ts")
  assert.deepEqual(args, [
    "run",
    "--no-prompt",
    "--no-config",
    "--no-lock",
    "--no-npm",
    "--no-remote",
    "--unstable-worker-options",
    "--allow-read=/trusted/generated-worker.ts",
    `--v8-flags=--max-old-space-size=${MAX_DENO_OLD_SPACE_MB}`,
    "/trusted/runner.ts",
  ])

  const allowFlags = args.filter((arg) => arg.startsWith("--allow-"))
  assert.deepEqual(allowFlags, ["--allow-read=/trusted/generated-worker.ts"])
  for (const forbidden of ["--allow-env", "--allow-write", "--allow-net", "--allow-run", "--allow-sys", "--allow-ffi", "--allow-import"]) {
    assert.equal(args.some((arg) => arg === forbidden || arg.startsWith(`${forbidden}=`)), false, forbidden)
  }
})
