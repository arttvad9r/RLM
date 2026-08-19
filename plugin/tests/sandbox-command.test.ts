import { MAX_DENO_OLD_SPACE_MB } from "../rlm-lib/constants.ts"
import { sandboxDenoArgs } from "../rlm-lib/sandbox.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test("sandbox Deno command grants only fixed worker-module read", () => {
  const args = sandboxDenoArgs("/trusted/runner.ts", "/trusted/generated-worker.ts")
  assert(JSON.stringify(args) === JSON.stringify([
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
  ]), `unexpected Deno args: ${JSON.stringify(args)}`)

  const allowFlags = args.filter((arg) => arg.startsWith("--allow-"))
  assert(JSON.stringify(allowFlags) === JSON.stringify(["--allow-read=/trusted/generated-worker.ts"]), `unexpected runner permissions: ${JSON.stringify(allowFlags)}`)
  for (const forbidden of ["--allow-env", "--allow-write", "--allow-net", "--allow-run", "--allow-sys", "--allow-ffi", "--allow-import"]) {
    assert(!args.some((arg) => arg === forbidden || arg.startsWith(`${forbidden}=`)), `unexpected permission ${forbidden}`)
  }
  for (const required of ["--no-prompt", "--no-config", "--no-lock", "--no-npm", "--no-remote"]) {
    assert(args.includes(required), `missing hardened runner flag ${required}`)
  }
})