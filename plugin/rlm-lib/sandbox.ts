/**
 * Sandbox execution / run lifecycle (host side). Spawns the trusted Deno
 * runner with read access only to its fixed generated-worker entry module,
 * drives protocol v1, enforces budgets and accepts only per-exec authenticated
 * runner frames from stdout. Model-generated code runs in a Worker with no
 * permissions.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import {
  MAX_CHILD_CALLS_PER_TURN,
  MAX_CHILD_RESULT_CHARS,
  MAX_CODE_CHARS,
  MAX_CONTEXT_CALLS,
  MAX_DENO_OLD_SPACE_MB,
  MAX_EXEC_TIMEOUT_MS,
  MAX_PROMPT_CHARS,
  MAX_PROTOCOL_LINE_CHARS,
  MAX_PROTOCOL_QUEUE_LINES,
  MAX_RESULT_CHARS,
  MAX_RLM_EXECS_PER_TURN,
  MAX_SANDBOX_STDERR_CHARS,
  MAX_SUBCALLS_CONCURRENT,
  MAX_SUBCALLS_TOTAL,
  MAX_TOTAL_CONTEXT_CHARS,
  PROTOCOL_VERSION,
} from "./constants.ts"
import { callChildLlm } from "./child.ts"
import { executeContextOperation } from "./context.ts"
import { RlmError, toErrorInfo } from "./errors.ts"
import { encodeMessage, parseSandboxFrame } from "./protocol.ts"
import { turnGovernor } from "./turn.ts"
import type {
  ContextRequestMessage,
  HostToSandboxMessage,
  Logger,
  RlmErrorInfo,
} from "./types.ts"
import { RlmRunState } from "./types.ts"
import { resolveWorkspaceRoot } from "./workspace.ts"

const TEST_EXEC_TIMEOUT_MS = Number(process.env.RLM_TEST_EXEC_TIMEOUT_MS) || 0
const RUNNER_PATH = fileURLToPath(new URL("../rlm-runner/runner.ts", import.meta.url))
const GENERATED_WORKER_PATH = fileURLToPath(new URL("../rlm-runner/generated-worker.ts", import.meta.url))

/**
 * The trusted transport runner may read only its fixed Worker entry module so
 * Deno can instantiate it. Project config, lockfile discovery, npm resolution
 * and remote module resolution are disabled explicitly; its module graph is
 * fixed and local. `--unstable-worker-options` then lets runner.ts revoke every
 * permission inside the generated-code Worker. The final V8 flag is host-owned
 * and overrides any inherited DENO_V8_FLAGS value.
 */
export function sandboxDenoArgs(
  runnerPath = RUNNER_PATH,
  generatedWorkerPath = GENERATED_WORKER_PATH,
): string[] {
  return [
    "run",
    "--no-prompt",
    "--no-config",
    "--no-lock",
    "--no-npm",
    "--no-remote",
    "--unstable-worker-options",
    `--allow-read=${generatedWorkerPath}`,
    `--v8-flags=--max-old-space-size=${MAX_DENO_OLD_SPACE_MB}`,
    runnerPath,
  ]
}

interface LineReader {
  next: () => Promise<string | undefined>
}

/** Bounded line-oriented reader for untrusted sandbox stdout. */
function makeLineReader(stream: NodeJS.ReadableStream): LineReader {
  const decoder = new TextDecoder()
  let buffer = ""
  const lines: string[] = []
  const waiting: Array<{
    resolve: (line: string | undefined) => void
    reject: (error: Error) => void
  }> = []
  let done = false
  let fatal: Error | undefined

  const rejectAll = (error: Error): void => {
    while (waiting.length > 0) waiting.shift()!.reject(error)
  }

  const fail = (message: string): void => {
    if (done) return
    fatal = new RlmError("PROTOCOL_ERROR", message)
    done = true
    buffer = ""
    lines.length = 0
    rejectAll(fatal)
  }

  const deliver = (line: string): void => {
    if (!line || done) return
    const waiter = waiting.shift()
    if (waiter) {
      waiter.resolve(line)
      return
    }
    if (lines.length >= MAX_PROTOCOL_QUEUE_LINES) {
      fail(`sandbox stdout queue exceeds ${MAX_PROTOCOL_QUEUE_LINES} protocol lines`)
      return
    }
    lines.push(line)
  }

  const push = (chunk: string): void => {
    if (done) return
    buffer += chunk
    for (;;) {
      const nl = buffer.indexOf("\n")
      if (nl === -1) break
      const raw = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (raw.length > MAX_PROTOCOL_LINE_CHARS) {
        fail(`sandbox stdout line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
        return
      }
      const line = raw.trim()
      if (line) deliver(line)
      if (done) return
    }
    if (buffer.length > MAX_PROTOCOL_LINE_CHARS) {
      fail(`sandbox stdout line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
    }
  }

  stream.on("data", (chunk: Buffer) => push(decoder.decode(chunk, { stream: true })))
  stream.on("end", () => {
    if (done) return
    const tail = decoder.decode()
    if (tail) push(tail)
    if (done) return
    if (buffer.length > MAX_PROTOCOL_LINE_CHARS) {
      fail(`sandbox stdout line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
      return
    }
    const line = buffer.trim()
    buffer = ""
    if (line) deliver(line)
    if (done) return
    done = true
    while (waiting.length > 0) waiting.shift()!.resolve(lines.shift())
  })
  stream.on("error", (error: Error) => {
    if (done) return
    fatal = new RlmError("PROTOCOL_ERROR", `sandbox stdout stream failed: ${error.message}`)
    done = true
    buffer = ""
    lines.length = 0
    rejectAll(fatal)
  })

  return {
    next: (): Promise<string | undefined> => {
      if (fatal) return Promise.reject(fatal)
      if (lines.length > 0) return Promise.resolve(lines.shift()!)
      if (done) return Promise.resolve(undefined)
      return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
    },
  }
}

export interface ExecuteRlmExecOptions {
  code: string
  parentSessionID: string
  directory: string
  worktree: string
  messageID: string
  abort: AbortSignal
  log: Logger
}

export interface RlmExecOutcome {
  output: string
  metadata: Record<string, unknown>
}

type ChildClient = Parameters<typeof callChildLlm>[0]
type ContextClient = Parameters<typeof executeContextOperation>[0]
type Client = Pick<ChildClient, "session" | "tool"> & Pick<ContextClient, "file">

function serializeFinalOutput(value: unknown): { compactChars: number; output: string } {
  let compact: string | undefined
  let output: string | undefined
  try {
    compact = JSON.stringify(value)
    output = typeof value === "string" ? value : JSON.stringify(value, null, 2)
  } catch (error) {
    throw new RlmError(
      "PROTOCOL_ERROR",
      `rlm_exec: final result is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (compact === undefined || output === undefined) {
    throw new RlmError("PROTOCOL_ERROR", "rlm_exec: final result is not JSON-serializable")
  }
  if (compact.length > MAX_RESULT_CHARS || output.length > MAX_RESULT_CHARS) {
    throw new RlmError("BUDGET_EXCEEDED", `rlm_exec: final result exceeds ${MAX_RESULT_CHARS} characters`)
  }
  return { compactChars: compact.length, output }
}

export async function executeRlmExec(
  client: Client,
  opts: ExecuteRlmExecOptions,
): Promise<RlmExecOutcome> {
  const { code, parentSessionID, directory: dir, log } = opts
  const ws = await resolveWorkspaceRoot(dir, opts.worktree ?? "")

  await log("debug", "rlm_exec workspace root", {
    workspaceRoot: ws.root,
    broadWorkspaceRoot: ws.broad,
    directory: dir,
    worktree: opts.worktree,
  })

  if (typeof code !== "string" || code.trim().length === 0) {
    throw new RlmError("INVALID_ARGUMENT", "rlm_exec: code must be a non-empty string")
  }
  if (code.length > MAX_CODE_CHARS) {
    throw new RlmError("BUDGET_EXCEEDED", `rlm_exec: code exceeds ${MAX_CODE_CHARS} characters`)
  }

  const baseTimeoutMs = TEST_EXEC_TIMEOUT_MS > 0 ? TEST_EXEC_TIMEOUT_MS : MAX_EXEC_TIMEOUT_MS
  const turn = await turnGovernor.beginExec(client, parentSessionID, dir, opts.messageID, baseTimeoutMs)
  if (!turn.allowed) {
    const s = turn.snapshot
    throw new RlmError(
      "BUDGET_EXCEEDED",
      `rlm turn budget exceeded: ${turn.reason} (turnId=${s.turnId}, execs=${s.execCount}/${MAX_RLM_EXECS_PER_TURN}, childCalls=${s.childCallCount}/${MAX_CHILD_CALLS_PER_TURN}, wallMsUsed=${s.wallMsUsed}, execsRemaining=${s.execsRemaining}, childCallsRemaining=${s.childCallsRemaining}, wallMsRemaining=${s.wallMsRemaining})`,
    )
  }
  const turnStartedAt = Date.now()
  const execTimeoutMs = turn.reservedWallMs
  const state = new RlmRunState({ workspaceRoot: ws.root, broadWorkspaceRoot: ws.broad, timeoutMs: execTimeoutMs })

  let child: ChildProcessWithoutNullStreams | undefined
  let finished = false
  let stderrText = ""
  let stderrTruncated = false
  let turnFinished = false
  let ignoredStdoutLines = 0
  const inflight = new Map<string, Promise<void>>()
  const seenRequestIDs = new Set<string>()
  const abortController = state.abort
  const protocolChannel = randomBytes(24).toString("hex")
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let finalOutput: string | undefined
  let finalResultChars = 0
  let haveResult = false
  let sandboxError: RlmErrorInfo | null = null
  let stdinError: Error | undefined

  const finishTurn = (): void => {
    if (turnFinished) return
    turnFinished = true
    turnGovernor.finishExec(parentSessionID, Date.now() - turnStartedAt, execTimeoutMs)
  }

  const appendStderr = (text: string): void => {
    const remaining = MAX_SANDBOX_STDERR_CHARS - stderrText.length
    if (remaining <= 0) {
      stderrTruncated = true
      return
    }
    stderrText += text.slice(0, remaining)
    if (text.length > remaining) stderrTruncated = true
  }

  const stderrDiagnostic = (): string => {
    if (!stderrText) return ""
    return `${stderrText.trim()}${stderrTruncated ? "\n[stderr truncated]" : ""}`
  }

  const writeToSandbox = (msg: HostToSandboxMessage): void => {
    if (finished || !child || child.stdin.destroyed) return
    const line = encodeMessage(msg)
    if (line.length > MAX_PROTOCOL_LINE_CHARS) {
      throw new RlmError("BUDGET_EXCEEDED", `host protocol line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
    }
    child.stdin.write(line + "\n")
  }

  const writeBootstrap = (): void => {
    if (!child || child.stdin.destroyed) throw new RlmError("RUNTIME_ERROR", "rlm_exec: sandbox stdin is unavailable")
    const line = JSON.stringify({ v: PROTOCOL_VERSION, type: "code", code, channel: protocolChannel })
    if (line.length > MAX_PROTOCOL_LINE_CHARS) {
      throw new RlmError("BUDGET_EXCEEDED", `host bootstrap line exceeds ${MAX_PROTOCOL_LINE_CHARS} characters`)
    }
    child.stdin.write(line + "\n")
  }

  const finishWithError = (message: string): RlmError => {
    finished = true
    abortController.abort()
    if (child && child.exitCode === null) child.kill("SIGKILL")
    return new RlmError("PROTOCOL_ERROR", message)
  }

  try {
    await log("debug", "rlm_exec started", {
      parentSessionID,
      directory: dir,
      workspaceRoot: ws.root,
      denoOldSpaceLimitMb: MAX_DENO_OLD_SPACE_MB,
    })

    child = spawn("deno", sandboxDenoArgs(), {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    })

    child.stderr.on("data", (d: Buffer) => appendStderr(d.toString()))
    child.stdin.on("error", (error: Error) => {
      stdinError ??= error
      appendStderr(`\n[stdin error] ${error.message}`)
      abortController.abort()
      if (child && child.exitCode === null) child.kill("SIGKILL")
    })
    child.on("error", (error) => appendStderr(`\n[spawn error] ${error.message}`))
    child.on("exit", (exitCode) => {
      state.exitCode = exitCode
    })

    const onRootAbort = () => {
      abortController.abort()
      if (child && child.exitCode === null) child.kill("SIGKILL")
      for (const p of inflight.values()) void p.catch(() => {})
    }
    if (opts.abort.aborted) onRootAbort()
    opts.abort.addEventListener("abort", onRootAbort, { once: true })

    watchdog = setTimeout(() => {
      timedOut = true
      state.timedOut = true
      abortController.abort()
      if (child && child.exitCode === null) child.kill("SIGKILL")
      for (const p of inflight.values()) void p.catch(() => {})
    }, execTimeoutMs)
    watchdog.unref?.()

    writeBootstrap()
    const stdout = makeLineReader(child.stdout)

    const handleLlm = async (id: string, promptValue: unknown): Promise<void> => {
      state.childCallCount++
      if (state.childCallCount > MAX_SUBCALLS_TOTAL) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `rlm budget exceeded: maximum ${MAX_SUBCALLS_TOTAL} llm prompts per rlm_exec` } })
        return
      }
      if (state.activeChildSessions.size >= MAX_SUBCALLS_CONCURRENT) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `rlm budget exceeded: maximum ${MAX_SUBCALLS_CONCURRENT} concurrent llm calls` } })
        return
      }
      if (!turnGovernor.childAllowed(parentSessionID)) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `rlm turn budget exceeded: maximum ${MAX_CHILD_CALLS_PER_TURN} child calls per user turn` } })
        return
      }
      if (typeof promptValue !== "string" || promptValue.trim().length === 0) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id, ok: false, error: { code: "INVALID_ARGUMENT", message: "llm: prompt must be a non-empty string" } })
        return
      }
      if (promptValue.length > MAX_PROMPT_CHARS) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `llm: prompt exceeds ${MAX_PROMPT_CHARS} characters` } })
        return
      }

      state.activeChildSessions.set(id, { sessionID: "", abort: () => {} })
      turnGovernor.registerChildStart(parentSessionID)
      try {
        const res = await callChildLlm(
          client,
          { prompt: promptValue, parentSessionID, directory: dir, title: "rlm_exec child", signal: abortController.signal },
          log,
        )
        state.childSessionIDs.push(res.childSessionID)
        state.childCostSum += res.cost ?? 0
        state.childTokensInputSum += res.tokensInput ?? 0
        state.childTokensOutputSum += res.tokensOutput ?? 0
        if (res.text.length > MAX_CHILD_RESULT_CHARS) {
          writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `llm result exceeds ${MAX_CHILD_RESULT_CHARS} characters` } })
          return
        }
        writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id, ok: true, text: res.text })
      } catch (error) {
        const info = toErrorInfo(error)
        writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id, ok: false, error: { code: info.code === "RUNTIME_ERROR" ? "CHILD_FAILED" : info.code, message: info.message } })
      } finally {
        state.activeChildSessions.delete(id)
      }
    }

    const handleContext = async (id: string, msg: ContextRequestMessage): Promise<void> => {
      if (!turnGovernor.beginContextCall(parentSessionID)) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "context_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `rlm turn budget exceeded: maximum ${turnGovernor.ctxCallsLimit()} context calls per user turn` } })
        return
      }
      state.contextCallCount++
      if (state.contextCallCount > MAX_CONTEXT_CALLS) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "context_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `context budget exceeded: maximum ${MAX_CONTEXT_CALLS} context calls per rlm_exec` } })
        return
      }
      let value: unknown
      try {
        value = (await executeContextOperation(client, state, dir, msg)).value
      } catch (error) {
        const info = toErrorInfo(error)
        writeToSandbox({ v: PROTOCOL_VERSION, type: "context_result", id, ok: false, error: info })
        return
      }
      const serialized = JSON.stringify(value)
      if (serialized === undefined) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "context_result", id, ok: false, error: { code: "PROTOCOL_ERROR", message: "context result is not JSON-serializable" } })
        return
      }
      if (serialized.length + state.contextCharsSent > MAX_TOTAL_CONTEXT_CHARS) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "context_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `context budget exceeded: total context data exceeds ${MAX_TOTAL_CONTEXT_CHARS} characters per rlm_exec` } })
        return
      }
      if (!turnGovernor.addContextChars(parentSessionID, serialized.length)) {
        writeToSandbox({ v: PROTOCOL_VERSION, type: "context_result", id, ok: false, error: { code: "BUDGET_EXCEEDED", message: `rlm turn budget exceeded: total context data exceeds ${turnGovernor.ctxCharsLimit()} characters per user turn` } })
        return
      }
      state.contextCharsSent += serialized.length
      writeToSandbox({ v: PROTOCOL_VERSION, type: "context_result", id, ok: true, value })
    }

    const startRequest = (
      id: string,
      taskFactory: () => Promise<void>,
      onError: (info: RlmErrorInfo) => void,
    ): void => {
      if (seenRequestIDs.has(id)) throw finishWithError(`duplicate sandbox request id: ${id}`)
      seenRequestIDs.add(id)
      const task = taskFactory()
        .catch((error) => onError(toErrorInfo(error)))
        .finally(() => inflight.delete(id))
      inflight.set(id, task)
    }

    for (;;) {
      const line = await stdout.next()
      if (line === undefined) break
      let msg: ReturnType<typeof parseSandboxFrame>
      try {
        msg = parseSandboxFrame(line, protocolChannel)
      } catch (error) {
        const info = toErrorInfo(error)
        throw finishWithError(`${info.code}: ${info.message}`)
      }
      if (msg === null) {
        ignoredStdoutLines++
        continue
      }

      if (msg.type === "llm") {
        startRequest(
          msg.id,
          () => handleLlm(msg.id, msg.prompt),
          (info) => writeToSandbox({ v: PROTOCOL_VERSION, type: "llm_result", id: msg.id, ok: false, error: { code: info.code === "RUNTIME_ERROR" ? "CHILD_FAILED" : info.code, message: info.message } }),
        )
        continue
      }
      if (msg.type === "context") {
        startRequest(
          msg.id,
          () => handleContext(msg.id, msg),
          (info) => writeToSandbox({ v: PROTOCOL_VERSION, type: "context_result", id: msg.id, ok: false, error: info }),
        )
        continue
      }
      if (msg.type === "result") {
        if (inflight.size > 0) {
          throw finishWithError(`sandbox returned final result with ${inflight.size} RPC request(s) still in flight`)
        }
        const serialized = serializeFinalOutput(msg.value)
        finalOutput = serialized.output
        finalResultChars = serialized.compactChars
        haveResult = true
        break
      }
      sandboxError = msg.error
      break
    }

    if (child.exitCode === null) {
      await new Promise<void>((resolve) => {
        child!.once("exit", () => resolve())
        child!.once("error", () => resolve())
      })
    }
    state.exitCode = child.exitCode

    if (watchdog) clearTimeout(watchdog)
    watchdog = undefined
    opts.abort.removeEventListener("abort", onRootAbort)

    const stderr = stderrDiagnostic()
    if (timedOut) {
      throw new RlmError("TIMEOUT", `rlm_exec: timeout after ${execTimeoutMs}ms (sandbox killed)${stderr ? `:\n${stderr}` : ""}`)
    }
    if (stdinError) {
      throw new RlmError("RUNTIME_ERROR", `rlm_exec: sandbox stdin failed: ${stdinError.message}${stderr ? `:\n${stderr}` : ""}`)
    }
    if (sandboxError) throw new RlmError(sandboxError.code, sandboxError.message)
    if (state.exitCode !== 0) {
      throw new RlmError("RUNTIME_ERROR", `rlm_exec: Deno sandbox exited with code ${state.exitCode}${stderr ? `:\n${stderr}` : ""}`)
    }
    if (!haveResult || finalOutput === undefined) {
      throw new RlmError("PROTOCOL_ERROR", `rlm_exec: sandbox exited without a final result${stderr ? `:\n${stderr}` : ""}`)
    }

    const metadata: Record<string, unknown> = {
      protocolVersion: state.protocolVersion,
      runId: state.runId,
      durationMs: Date.now() - state.startedAt,
      workspaceRoot: ws.root,
      broadWorkspaceRoot: ws.broad,
      denoOldSpaceLimitMb: MAX_DENO_OLD_SPACE_MB,
      childCallCount: state.childCallCount,
      contextCallCount: state.contextCallCount,
      contextCharsSent: state.contextCharsSent,
      finalResultChars,
      childSessionIDs: [...state.childSessionIDs],
      childCostSum: round6(state.childCostSum),
      childTokensInputSum: state.childTokensInputSum,
      childTokensOutputSum: state.childTokensOutputSum,
      timedOut: state.timedOut,
      exitCode: state.exitCode,
      stderrTruncated,
      ignoredStdoutLines,
    }

    finishTurn()
    const turnSnap = turnGovernor.snapshot(parentSessionID)
    if (turnSnap) {
      metadata.turnId = turnSnap.turnId
      metadata.turnExecCount = turnSnap.execCount
      metadata.turnChildCallCount = turnSnap.childCallCount
      metadata.turnContextCallCount = turnSnap.contextCallCount
      metadata.turnContextCharsSent = turnSnap.contextCharsSent
      metadata.turnWallMsUsed = turnSnap.wallMsUsed
      metadata.turnExecsRemaining = turnSnap.execsRemaining
      metadata.turnChildCallsRemaining = turnSnap.childCallsRemaining
      metadata.turnContextCallsRemaining = turnSnap.contextCallsRemaining
      metadata.turnContextCharsRemaining = turnSnap.contextCharsRemaining
      metadata.turnWallMsRemaining = turnSnap.wallMsRemaining
    }
    await log("info", "rlm_exec completed", metadata)
    return { output: finalOutput, metadata }
  } catch (error) {
    const info = toErrorInfo(error)
    finishTurn()
    await log("error", "rlm_exec failed", {
      parentSessionID,
      exitCode: state.exitCode,
      workspaceRoot: ws.root,
      childSessionIDs: [...state.childSessionIDs],
      stderr: stderrDiagnostic().slice(0, 2000),
      error: `${info.code}: ${info.message}`,
    })
    const message = info.message.startsWith(`${info.code}: `) ? info.message : `${info.code}: ${info.message}`
    throw new RlmError(info.code, message)
  } finally {
    finished = true
    if (watchdog) clearTimeout(watchdog)
    if (child && child.exitCode === null) child.kill("SIGKILL")
    if (child) {
      try {
        child.stdin.end()
      } catch {
        // ignore
      }
    }
    state.cleanup()
  }
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6
}
