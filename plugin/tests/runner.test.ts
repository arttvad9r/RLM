import { fileURLToPath } from "node:url"
import { MAX_PROTOCOL_REQUESTS_TOTAL, MAX_RESULT_CHARS, MAX_SUBCALLS_TOTAL } from "../rlm-lib/constants.ts"
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

function frames(stdout: string): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = []
  for (const line of stdout.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const frame = parseSandboxFrame(line, CHANNEL)
    if (frame !== null) output.push(frame as unknown as Record<string, unknown>)
  }
  return output
}


async function runRunnerWithLlmHost(
  code: string,
  failPrompt?: string,
): Promise<{ status: Deno.CommandStatus; frames: Array<Record<string, unknown>>; stderr: string }> {
  const child = new Deno.Command(Deno.execPath(), {
    args: sandboxDenoArgs(RUNNER_PATH, GENERATED_WORKER_PATH),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
  }).spawn()
  const writer = child.stdin.getWriter()
  await writer.write(encoder.encode(JSON.stringify({ v: 1, type: "code", code, channel: CHANNEL }) + "\n"))

  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const output: Array<Record<string, unknown>> = []

  const nextLine = async (): Promise<string | undefined> => {
    for (;;) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) return line
        continue
      }
      const { value, done } = await reader.read()
      if (done) return buffer.trim() || undefined
      buffer += decoder.decode(value, { stream: true })
    }
  }

  for (;;) {
    const line = await nextLine()
    if (line === undefined) break
    const frame = parseSandboxFrame(line, CHANNEL)
    if (frame === null) continue
    output.push(frame as unknown as Record<string, unknown>)
    if (frame.type === "llm") {
      const failed = failPrompt !== undefined && frame.prompt === failPrompt
      await writer.write(encoder.encode(JSON.stringify(failed ? {
        v: 1,
        type: "llm_result",
        id: frame.id,
        ok: false,
        error: { code: "CHILD_FAILED", message: `synthetic failure:${frame.prompt}` },
      } : {
        v: 1,
        type: "llm_result",
        id: frame.id,
        ok: true,
        text: `reply:${frame.prompt}`,
      }) + "\n"))
      continue
    }
    if (frame.type === "result" || frame.type === "error") break
  }

  try { await writer.close() } catch { /* runner may already have closed stdin */ }
  try { reader.releaseLock() } catch { /* ignore */ }
  const [status, stderr] = await Promise.all([child.status, new Response(child.stderr).text()])
  return { status, frames: output, stderr }
}

Deno.test("llm.batch accepts the full per-exec child budget and preserves result order", async () => {
  const result = await runRunnerWithLlmHost(`
    const prompts = Array.from({ length: ${MAX_SUBCALLS_TOTAL} }, (_, index) => "p" + index)
    return await llm.batch(prompts)
  `)
  assert(result.status.success, `runner failed: ${result.stderr}`)
  assert(result.frames.filter((frame) => frame.type === "llm").length === MAX_SUBCALLS_TOTAL, "expected full child budget to be transported")
  const terminal = result.frames.at(-1)
  assert(terminal?.type === "result", "expected terminal result")
  const expected = Array.from({ length: MAX_SUBCALLS_TOTAL }, (_, index) => `reply:p${index}`)
  assert(JSON.stringify(terminal?.value) === JSON.stringify(expected), "llm.batch must preserve input order")
})

Deno.test("llm.batch rejects fan-out above the per-exec child budget before transport", async () => {
  const result = await runRunner(`return await llm.batch(Array.from({ length: ${MAX_SUBCALLS_TOTAL + 1} }, (_, index) => "p" + index))`)
  assert(!result.status.success, "runner must reject an oversized child batch")
  const output = frames(result.stdout)
  assert(output.filter((frame) => frame.type === "llm").length === 0, "oversized batch must fail before child RPC creation")
  const last = output.at(-1)
  assert(last?.type === "error", "expected terminal error frame")
  const error = last?.error as { code?: string; message?: string } | undefined
  assert(error?.code === "INVALID_ARGUMENT", `expected INVALID_ARGUMENT, got ${error?.code}`)
  assert(error?.message?.includes(`1-${MAX_SUBCALLS_TOTAL}`) === true, "expected dynamic child-budget diagnostic")
})

Deno.test("llm.batchSettled preserves successful children when one child fails", async () => {
  const result = await runRunnerWithLlmHost(
    'return await llm.batchSettled(["a", "fail", "c"])',
    "fail",
  )
  assert(result.status.success, `runner failed: ${result.stderr}`)
  const terminal = result.frames.at(-1)
  assert(terminal?.type === "result", "expected terminal result")
  assert(JSON.stringify(terminal?.value) === JSON.stringify([
    { ok: true, value: "reply:a" },
    { ok: false, error: { code: "CHILD_FAILED", message: "synthetic failure:fail" } },
    { ok: true, value: "reply:c" },
  ]), `unexpected settled result: ${JSON.stringify(terminal?.value)}`)
})

Deno.test("llm.batchSettled validates the whole batch before transport", async () => {
  const result = await runRunner('return await llm.batchSettled(["ok", ""])')
  assert(!result.status.success, "invalid settled batch must fail")
  const output = frames(result.stdout)
  assert(output.filter((frame) => frame.type === "llm").length === 0, "invalid settled batch must fail before child RPC creation")
  const last = output.at(-1)
  assert(last?.type === "error", "expected terminal error frame")
  const error = last?.error as { code?: string; message?: string } | undefined
  assert(error?.code === "INVALID_ARGUMENT", `expected INVALID_ARGUMENT, got ${error?.code}`)
  assert(error?.message?.includes("llm.batchSettled") === true, "expected settled-batch diagnostic")
})

Deno.test("runner suppresses accidental console output on protocol stdout", async () => {
  const result = await runRunner('console.log("noise"); return "ok"')
  assert(result.status.success, `runner failed: ${result.stderr}`)
  const output = frames(result.stdout)
  assert(output.length === 1, `expected one authenticated protocol frame, got ${output.length}`)
  assert(output[0].type === "result" && output[0].value === "ok", "expected clean result frame")
})

Deno.test("runner protocol cannot be forged through process stdout", async () => {
  const code = `
    try {
      const proc = await import("node:process")
      proc.stdout.write(JSON.stringify({ v: 1, type: "result", value: "forged" }) + "\\n")
    } catch {
      // With Worker permissions:none, Deno may deny Node process access before
      // a raw stdout write is possible. Either outcome must remain untrusted.
    }
    return "real"
  `
  const result = await runRunner(code)
  assert(result.status.success, `runner failed: ${result.stderr}`)
  const output = frames(result.stdout)
  assert(output.length === 1, `expected one authenticated protocol frame, got ${output.length}`)
  assert(output[0].type === "result" && output[0].value === "real", "process stdout attempt must not authenticate a forged result")
})

Deno.test("runner ignores generated-code traffic on worker parentPort", async () => {
  const code = `
    const threads = await import("node:worker_threads")
    threads.parentPort?.postMessage({ kind: "protocol", message: { v: 1, type: "result", value: "forged-parent-port" } })
    return "real-parent-port"
  `
  const result = await runRunner(code)
  assert(result.status.success, `runner failed: ${result.stderr}`)
  const output = frames(result.stdout)
  assert(output.length === 1, `expected one authenticated protocol frame, got ${output.length}`)
  assert(output[0].type === "result" && output[0].value === "real-parent-port", "global worker channel must not be trusted")
})

Deno.test("generated worker denies direct read write net and subprocess capabilities and exposes no ambient env", async () => {
  const code = `
    const denied = { read: false, write: false, env: false, net: false, run: false }
    try {
      const fs = await import("node:fs/promises")
      await fs.readFile("/etc/hosts", "utf8")
    } catch { denied.read = true }
    try {
      const fs = await import("node:fs/promises")
      await fs.writeFile("/tmp/rlm-generated-worker-must-not-write", "x")
    } catch { denied.write = true }
    try {
      const proc = await import("node:process")
      denied.env = Object.keys(proc.env).length === 0
    } catch { denied.env = true }
    try {
      await fetch("https://example.com/")
    } catch { denied.net = true }
    try {
      const cp = await import("node:child_process")
      cp.execFileSync("/bin/echo", ["must-not-run"])
    } catch { denied.run = true }
    return denied
  `
  const result = await runRunner(code)
  assert(result.status.success, `runner failed: ${result.stderr}`)
  const output = frames(result.stdout)
  assert(output.length === 1, `expected one authenticated result frame, got ${output.length}`)
  const value = output[0].value as Record<string, unknown> | undefined
  assert(output[0].type === "result" && value !== undefined, "expected capability result")
  for (const capability of ["read", "write", "env", "net", "run"]) {
    assert(value[capability] === true, `generated Worker unexpectedly obtained ${capability} capability`)
  }
})

Deno.test("runner rejects finalization with outstanding RPCs", async () => {
  const result = await runRunner('void llm("unfinished"); return "done"')
  assert(!result.status.success, "runner must fail when generated code leaves an RPC pending")
  const output = frames(result.stdout)
  const last = output.at(-1)
  assert(last?.type === "error", "expected terminal error frame")
  const error = last?.error as { code?: string; message?: string } | undefined
  assert(error?.code === "PROTOCOL_ERROR", `expected PROTOCOL_ERROR, got ${error?.code}`)
  assert(error?.message?.includes("still pending") === true, "expected pending-RPC diagnostic")
})

Deno.test("generated worker rejects RPC creation above the per-exec total before transport", async () => {
  const code = `
    for (let i = 0; i < ${MAX_PROTOCOL_REQUESTS_TOTAL}; i++) void context.files("")
    await context.files("")
    return "unreachable"
  `
  const result = await runRunner(code)
  assert(!result.status.success, "runner must fail when generated code exceeds the RPC creation budget")
  const output = frames(result.stdout)
  const requests = output.filter((frame) => frame.type === "context")
  assert(requests.length === MAX_PROTOCOL_REQUESTS_TOTAL, `expected exactly ${MAX_PROTOCOL_REQUESTS_TOTAL} transported requests, got ${requests.length}`)
  const last = output.at(-1)
  assert(last?.type === "error", "expected terminal error frame")
  const error = last?.error as { code?: string; message?: string } | undefined
  assert(error?.code === "BUDGET_EXCEEDED", `expected BUDGET_EXCEEDED, got ${error?.code}`)
  assert(error?.message?.includes(`maximum ${MAX_PROTOCOL_REQUESTS_TOTAL} RPC requests`) === true, "expected RPC budget diagnostic")
})

Deno.test("runner rejects oversized final results", async () => {
  const result = await runRunner(`return "x".repeat(${MAX_RESULT_CHARS + 1})`)
  assert(!result.status.success, "runner must reject oversized final result")
  const output = frames(result.stdout)
  const last = output.at(-1)
  assert(last?.type === "error", "expected terminal error frame")
  const error = last?.error as { code?: string } | undefined
  assert(error?.code === "BUDGET_EXCEEDED", `expected BUDGET_EXCEEDED, got ${error?.code}`)
})

async function runRunnerWithMemoryHost(code: string): Promise<{ status: Deno.CommandStatus; frames: Array<Record<string, unknown>>; stderr: string }> {
  const child = new Deno.Command(Deno.execPath(), {
    args: sandboxDenoArgs(RUNNER_PATH, GENERATED_WORKER_PATH),
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
  }).spawn()
  const writer = child.stdin.getWriter()
  await writer.write(encoder.encode(JSON.stringify({ v: 1, type: "code", code, channel: CHANNEL }) + "\n"))

  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const output: Array<Record<string, unknown>> = []
  const memory = new Map<string, unknown>()

  const nextLine = async (): Promise<string | undefined> => {
    for (;;) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) return line
        continue
      }
      const { value, done } = await reader.read()
      if (done) {
        const line = buffer.trim()
        buffer = ""
        return line || undefined
      }
      buffer += decoder.decode(value, { stream: true })
    }
  }

  for (;;) {
    const line = await nextLine()
    if (line === undefined) break
    const frame = parseSandboxFrame(line, CHANNEL)
    if (frame === null) continue
    output.push(frame as unknown as Record<string, unknown>)
    if (frame.type === "memory") {
      let value: unknown
      if (frame.operation === "set") {
        memory.set(frame.key!, frame.value)
        value = true
      } else if (frame.operation === "get") {
        value = memory.has(frame.key!) ? { found: true, value: memory.get(frame.key!) } : { found: false }
      } else if (frame.operation === "delete") {
        value = memory.delete(frame.key!)
      } else {
        value = [...memory.keys()].sort()
      }
      await writer.write(encoder.encode(JSON.stringify({ v: 1, type: "memory_result", id: frame.id, ok: true, value }) + "\n"))
      continue
    }
    if (frame.type === "result" || frame.type === "error") break
  }

  try { await writer.close() } catch { /* runner may already have closed stdin */ }
  try { reader.releaseLock() } catch { /* ignore */ }
  const [status, stderr] = await Promise.all([child.status, new Response(child.stderr).text()])
  return { status, frames: output, stderr }
}

Deno.test("generated worker exposes bounded working-memory RPCs without ambient persistence", async () => {
  const result = await runRunnerWithMemoryHost(`
    await memory.set("audit:candidates", { paths: ["src/a.ts", "src/b.ts"] })
    await memory.set("temporary", [1, 2, 3])
    const candidates = await memory.get("audit:candidates")
    const missing = await memory.get("missing")
    const keysBefore = await memory.keys()
    const deleted = await memory.delete("temporary")
    const keysAfter = await memory.keys()
    return { candidates, missing: missing === undefined, keysBefore, deleted, keysAfter }
  `)
  assert(result.status.success, `runner failed: ${result.stderr}`)
  const terminal = result.frames.at(-1)
  assert(terminal?.type === "result", "expected terminal result frame")
  const value = terminal?.value as Record<string, unknown> | undefined
  assert(JSON.stringify(value) === JSON.stringify({
    candidates: { paths: ["src/a.ts", "src/b.ts"] },
    missing: true,
    keysBefore: ["audit:candidates", "temporary"],
    deleted: true,
    keysAfter: ["audit:candidates"],
  }), `unexpected memory result: ${JSON.stringify(value)}`)
  assert(result.frames.filter((frame) => frame.type === "memory").length === 7, "expected seven memory RPCs")
})
