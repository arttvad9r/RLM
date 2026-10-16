import { fileURLToPath } from "node:url"
import { parseSandboxFrame } from "../rlm-lib/protocol.ts"
import { sandboxDenoArgs } from "../rlm-lib/sandbox.ts"

const RUNNER_PATH = fileURLToPath(new URL("../rlm-runner/runner.ts", import.meta.url))
const GENERATED_WORKER_PATH = fileURLToPath(new URL("../rlm-runner/generated-worker.ts", import.meta.url))
const encoder = new TextEncoder()
const CHANNEL = "0123456789abcdef0123456789abcdef0123456789abcdef"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function runRunner(code: string): Promise<{ status: Deno.CommandStatus; stdout: string; stderr: string }> {
  const child = new Deno.Command(Deno.execPath(), {
    args: sandboxDenoArgs(RUNNER_PATH, GENERATED_WORKER_PATH),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
  }).spawn()

  const writer = child.stdin.getWriter()
  await writer.write(encoder.encode(JSON.stringify({ v: 1, type: "code", code, channel: CHANNEL }) + "\n"))
  await writer.close()

  const [status, stdout, stderr] = await Promise.all([
    child.status,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { status, stdout, stderr }
}

function resultValue(stdout: string): unknown {
  const frames = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSandboxFrame(line, CHANNEL))
    .filter((frame) => frame !== null)
  assert(frames.length === 1, `expected one authenticated protocol frame, got ${frames.length}`)
  const frame = frames[0]
  assert(frame?.type === "result", `expected result frame, got ${frame?.type ?? "none"}`)
  return frame.value
}

async function assertEscapeDenied(code: string, label: string): Promise<void> {
  const result = await runRunner(code)
  assert(result.status.success, `${label}: runner failed instead of returning the probe result: ${result.stderr}`)
  assert(resultValue(result.stdout) === false, `${label}: generated Worker unexpectedly obtained authority`)
}

Deno.test("generated Worker cannot read host files through node:fs", async () => {
  const target = JSON.stringify(RUNNER_PATH)
  await assertEscapeDenied(`
    let escaped = false
    try {
      const fs = await import("node:fs/promises")
      await fs.readFile(${target}, "utf8")
      escaped = true
    } catch {
      // Expected: the Worker has permissions:none.
    }
    return escaped
  `, "node:fs")
})

Deno.test("generated Worker cannot spawn subprocesses through node:child_process", async () => {
  const denoPath = JSON.stringify(Deno.execPath())
  await assertEscapeDenied(`
    let escaped = false
    try {
      const childProcess = await import("node:child_process")
      const result = childProcess.spawnSync(${denoPath}, ["--version"], { encoding: "utf8" })
      escaped = result.status === 0
    } catch {
      // Expected: the Worker has permissions:none.
    }
    return escaped
  `, "node:child_process")
})

Deno.test("generated Worker receives no ambient environment through node:process", async () => {
  await assertEscapeDenied(`
    let escaped = false
    try {
      const proc = await import("node:process")
      escaped = Object.keys(proc.env).length > 0
    } catch {
      // A permission error is also an acceptable denial.
    }
    return escaped
  `, "node:process.env")
})

Deno.test("generated Worker cannot bind network sockets through node:net", async () => {
  await assertEscapeDenied(`
    let escaped = false
    try {
      const net = await import("node:net")
      escaped = await new Promise((resolve) => {
        const server = net.createServer()
        let settled = false
        const finish = (value) => {
          if (settled) return
          settled = true
          try { server.close() } catch {}
          resolve(value)
        }
        server.once("error", () => finish(false))
        server.listen(0, "127.0.0.1", () => finish(true))
        setTimeout(() => finish(false), 250)
      })
    } catch {
      // Expected: the Worker has permissions:none.
    }
    return escaped
  `, "node:net")
})
