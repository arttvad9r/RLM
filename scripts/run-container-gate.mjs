#!/usr/bin/env node
import { spawnSync } from "node:child_process"

const IMAGE = "rlm-local-gate:node24-deno2"

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} is not installed or not available on PATH`)
  }
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`)
}

try {
  run("docker", ["build", "--pull", "-f", "scripts/Dockerfile.local-gate", "-t", IMAGE, "."])
  run("docker", ["run", "--rm", IMAGE])
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
