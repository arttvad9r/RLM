/**
 * Trusted RLM sandbox transport (protocol v1).
 *
 * The Deno transport process has narrowly scoped read access only so it can
 * instantiate generated-worker.ts. Model-generated code runs inside that
 * Worker with `permissions: "none"`. Runner<->Worker RPC uses a private
 * transferred MessagePort; the Worker's global message channel is never
 * trusted. Runner->Node stdout frames additionally carry a per-exec
 * authenticated channel because generated code can still write raw process
 * stdout through Node compatibility APIs.
 */
import {
  MAX_MEMORY_KEY_CHARS,
  MAX_MEMORY_VALUE_CHARS,
  MAX_PROTOCOL_LINE_CHARS,
  MAX_PROTOCOL_QUEUE_LINES,
  MAX_PROTOCOL_REQUESTS_TOTAL,
  MAX_READ_MANY_FILES,
  MAX_RESULT_CHARS,
  MAX_SUBCALLS_TOTAL,
  PROTOCOL_VERSION,
} from "../rlm-lib/constants.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import {
  encodeSandboxFrame,
  parseHostMessage,
  parseSandboxMessage,
  validateProtocolChannel,
} from "../rlm-lib/protocol.ts"
import type {
  HostToSandboxMessage,
  RlmErrorInfo,
  SandboxToHostMessage,
} from "../rlm-lib/types.ts"
import { writeAllSync } from "./write-all.ts"

const encoder = new TextEncoder()
const GENERATED_WORKER_URL = new URL("./generated-worker.ts", import.meta.url).href
let protocolChannel: string | undefined
let generatedWorker: Worker | undefined
let generatedPort: MessagePort | undefined

function writeMessage(message: SandboxToHostMessage): void {
  if (!protocolChannel) throw new RlmError("PROTOCOL_ERROR", "sandbox protocol channel is not initialized")
  const line = encodeSandboxFrame(protocolChannel, message)
  if (line.length > MAX_PROTOCOL_LINE_CHARS) {
    throw new RlmError("BUDGET_EXCEEDED", `sandbox protocol line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
  }
  writeAllSync(Deno.stdout, encoder.encode(line + "\n"))
}

function fail(error: RlmErrorInfo): never {
  Deno.stderr.writeSync(encoder.encode(`[rlm-runner] ${error.code}: ${error.message}\n`))
  try {
    if (protocolChannel) writeMessage({ v: PROTOCOL_VERSION, type: "error", error })
  } catch {
    // stdout may be unavailable or the diagnostic may exceed a transport bound.
  }
  try { generatedPort?.close() } catch { /* ignore cleanup failures */ }
  try { generatedWorker?.terminate() } catch { /* ignore cleanup failures */ }
  Deno.exit(1)
}

function lineReader(): { next: () => Promise<string | undefined>; close: () => Promise<void> } {
  const decoder = new TextDecoder()
  let buffer = ""
  let done = false
  let fatal: Error | undefined
  const waiters: Array<{
    resolve: (line: string | undefined) => void
    reject: (error: Error) => void
  }> = []
  const queue: string[] = []
  const reader = Deno.stdin.readable.getReader()

  const rejectAll = (error: Error): void => {
    while (waiters.length > 0) waiters.shift()!.reject(error)
  }

  const failReader = (message: string): void => {
    if (done) return
    fatal = new RlmError("PROTOCOL_ERROR", message)
    done = true
    buffer = ""
    queue.length = 0
    rejectAll(fatal)
    void reader.cancel().catch(() => {})
  }

  const deliver = (line: string): void => {
    if (!line || done) return
    const waiter = waiters.shift()
    if (waiter) {
      waiter.resolve(line)
      return
    }
    if (queue.length >= MAX_PROTOCOL_QUEUE_LINES) {
      failReader(`host protocol queue exceeds ${MAX_PROTOCOL_QUEUE_LINES} lines`)
      return
    }
    queue.push(line)
  }

  const pump = async (): Promise<void> => {
    for (;;) {
      const { value, done: readDone } = await reader.read()
      if (readDone) {
        if (buffer.length > MAX_PROTOCOL_LINE_CHARS) {
          failReader(`host protocol line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
          return
        }
        const line = buffer.trim()
        buffer = ""
        if (line) deliver(line)
        if (done) return
        done = true
        while (waiters.length > 0) waiters.shift()!.resolve(queue.shift())
        return
      }
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const nl = buffer.indexOf("\n")
        if (nl === -1) break
        const raw = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (raw.length > MAX_PROTOCOL_LINE_CHARS) {
          failReader(`host protocol line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
          return
        }
        const line = raw.trim()
        if (line) deliver(line)
        if (done) return
      }
      if (buffer.length > MAX_PROTOCOL_LINE_CHARS) {
        failReader(`host protocol line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
        return
      }
    }
  }

  void pump().catch((error: unknown) => {
    failReader(`stdin error: ${error instanceof Error ? error.message : String(error)}`)
  })

  return {
    next: () => {
      if (fatal) return Promise.reject(fatal)
      if (queue.length > 0) return Promise.resolve(queue.shift()!)
      if (done) return Promise.resolve(undefined)
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
    },
    close: () => reader.cancel().catch(() => {}),
  }
}

function bootstrapChannel(line: string): string {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    throw new RlmError("PROTOCOL_ERROR", "malformed bootstrap frame")
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new RlmError("PROTOCOL_ERROR", "bootstrap frame is not an object")
  }
  return validateProtocolChannel((raw as Record<string, unknown>).channel)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function main(): Promise<void> {
  const stdin = lineReader()
  const firstLine = await stdin.next().catch((error: unknown) => {
    const info = error instanceof RlmError ? error.toInfo() : { code: "PROTOCOL_ERROR" as const, message: String(error) }
    fail(info)
  })
  if (firstLine === undefined) fail({ code: "PROTOCOL_ERROR", message: "expected bootstrap code frame, got EOF" })

  let first: HostToSandboxMessage
  try {
    protocolChannel = bootstrapChannel(firstLine)
    first = parseHostMessage(firstLine)
  } catch (error) {
    const info = error instanceof RlmError ? error.toInfo() : { code: "PROTOCOL_ERROR" as const, message: String(error) }
    fail(info)
  }
  if (first.type !== "code") fail({ code: "PROTOCOL_ERROR", message: `expected first host message type "code", got ${first.type}` })

  const worker = new Worker(GENERATED_WORKER_URL, {
    type: "module",
    name: "rlm-generated-code",
    deno: { permissions: "none" },
  })
  generatedWorker = worker
  const channel = new MessageChannel()
  const port = channel.port1
  generatedPort = port
  const outstanding = new Set<string>()
  let completed = false
  let resolveCompletion!: () => void
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve })

  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault()
    fail({ code: "RUNTIME_ERROR", message: `generated-code worker failed: ${event.message}` })
  }
  worker.onmessageerror = () => {
    fail({ code: "PROTOCOL_ERROR", message: "generated-code worker global channel emitted an unserializable message" })
  }

  port.onmessageerror = () => {
    fail({ code: "PROTOCOL_ERROR", message: "generated-code private port emitted an unserializable message" })
  }
  port.onmessage = (event: MessageEvent<unknown>) => {
    const envelope = event.data
    if (!isRecord(envelope) || envelope.kind !== "protocol") {
      fail({ code: "PROTOCOL_ERROR", message: "generated-code private port emitted an invalid envelope" })
    }

    let message: SandboxToHostMessage
    try {
      message = parseSandboxMessage(JSON.stringify(envelope.message))
    } catch (error) {
      const info = error instanceof RlmError ? error.toInfo() : { code: "PROTOCOL_ERROR" as const, message: String(error) }
      fail(info)
    }

    if (message.type === "llm" || message.type === "context" || message.type === "memory") {
      if (outstanding.has(message.id)) fail({ code: "PROTOCOL_ERROR", message: `duplicate worker request id: ${message.id}` })
      outstanding.add(message.id)
      writeMessage(message)
      return
    }
    if (message.type === "result") {
      if (outstanding.size > 0) {
        fail({ code: "PROTOCOL_ERROR", message: `generated code returned with ${outstanding.size} RPC request(s) still pending; await all llm/context/memory calls` })
      }
      writeMessage(message)
      completed = true
      resolveCompletion()
      return
    }
    fail(message.error)
  }
  port.start()

  const hostLoop = (async (): Promise<void> => {
    for (;;) {
      const line = await stdin.next()
      if (line === undefined) return
      let message: HostToSandboxMessage
      try {
        message = parseHostMessage(line)
      } catch (error) {
        const info = error instanceof RlmError ? error.toInfo() : { code: "PROTOCOL_ERROR" as const, message: String(error) }
        fail(info)
      }
      if (message.type !== "llm_result" && message.type !== "context_result" && message.type !== "memory_result") {
        fail({ code: "PROTOCOL_ERROR", message: `unexpected host message type: ${message.type}` })
      }
      if (!outstanding.has(message.id)) {
        fail({ code: "PROTOCOL_ERROR", message: `unexpected ${message.type} for unknown id ${message.id}` })
      }
      outstanding.delete(message.id)
      port.postMessage({ kind: "host", message })
    }
  })()
  hostLoop.catch((error: unknown) => {
    if (completed) return
    const info = error instanceof RlmError ? error.toInfo() : { code: "PROTOCOL_ERROR" as const, message: String(error) }
    fail(info)
  })

  // The transferred port is the only Worker channel the runner trusts. Any
  // global postMessage/parentPort traffic from generated code has no listener.
  worker.postMessage({
    kind: "bootstrap",
    code: first.code,
    port: channel.port2,
    limits: {
      protocolVersion: PROTOCOL_VERSION,
      maxReadManyFiles: MAX_READ_MANY_FILES,
      maxResultChars: MAX_RESULT_CHARS,
      maxProtocolRequestsTotal: MAX_PROTOCOL_REQUESTS_TOTAL,
      maxSubcallsTotal: MAX_SUBCALLS_TOTAL,
      maxMemoryKeyChars: MAX_MEMORY_KEY_CHARS,
      maxMemoryValueChars: MAX_MEMORY_VALUE_CHARS,
    },
  }, [channel.port2])
  await completion

  try { port.close() } catch { /* ignore cleanup after valid result */ }
  try { worker.terminate() } catch { /* ignore cleanup after valid result */ }
  await stdin.close()
}

await main()