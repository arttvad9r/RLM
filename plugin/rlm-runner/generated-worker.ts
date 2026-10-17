import type {
  ContextRequestMessage,
  GrepMatch,
  HostToSandboxMessage,
  LlmRequestMessage,
  MemoryRequestMessage,
  ReadManyItem,
  RlmErrorInfo,
  SandboxToHostMessage,
} from "../rlm-lib/types.ts"

class ApiError extends Error {
  constructor(readonly code: RlmErrorInfo["code"], message: string) {
    super(message)
    this.name = "ApiError"
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }
type RuntimeLimits = {
  protocolVersion: 1
  maxReadManyFiles: number
  maxResultChars: number
  maxProtocolRequestsTotal: number
  maxSubcallsTotal: number
  maxMemoryKeyChars: number
  maxMemoryValueChars: number
}
type BootstrapEnvelope = { kind: "bootstrap"; code: string; port: MessagePort; limits: RuntimeLimits }

const subscribeGlobalMessage = (listener: EventListener): void => {
  globalThis.addEventListener("message", listener)
}
const safeStringify = JSON.stringify.bind(JSON)
const randomUUID = crypto.randomUUID.bind(crypto)
const quietConsole = Object.freeze({ log() {}, info() {}, warn() {}, error() {}, debug() {} })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorInfo(error: unknown): RlmErrorInfo {
  if (error instanceof ApiError) return { code: error.code, message: error.message }
  return { code: "RUNTIME_ERROR", message: error instanceof Error ? error.message : String(error) }
}

function validRuntimeLimits(value: unknown): value is RuntimeLimits {
  if (!isRecord(value)) return false
  return value.protocolVersion === 1
    && Number.isSafeInteger(value.maxReadManyFiles) && Number(value.maxReadManyFiles) > 0
    && Number.isSafeInteger(value.maxResultChars) && Number(value.maxResultChars) > 0
    && Number.isSafeInteger(value.maxProtocolRequestsTotal) && Number(value.maxProtocolRequestsTotal) > 0
    && Number.isSafeInteger(value.maxSubcallsTotal) && Number(value.maxSubcallsTotal) > 0
    && Number.isSafeInteger(value.maxMemoryKeyChars) && Number(value.maxMemoryKeyChars) > 0
    && Number.isSafeInteger(value.maxMemoryValueChars) && Number(value.maxMemoryValueChars) > 0
}

function hideAmbientRuntimeGlobals(): void {
  for (const [name, value] of [
    ["Deno", undefined],
    ["process", undefined],
    ["console", quietConsole],
    ["postMessage", undefined],
    ["addEventListener", undefined],
    ["close", undefined],
    ["Worker", undefined],
    ["MessageChannel", undefined],
    ["MessagePort", undefined],
    ["localStorage", undefined],
    ["caches", undefined],
    ["Blob", undefined],
    ["File", undefined],
  ] as const) {
    try {
      Object.defineProperty(globalThis, name, { value, writable: false, configurable: false })
    } catch {
      // The private transferred port is the trust boundary. Hiding globals is
      // only defense in depth against accidental ambient-runtime use.
    }
  }
}

function startRuntime(port: MessagePort, code: string, limits: RuntimeLimits): void {
  const PROTOCOL_VERSION = limits.protocolVersion
  const MAX_READ_MANY_FILES = limits.maxReadManyFiles
  const MAX_RESULT_CHARS = limits.maxResultChars
  const MAX_PROTOCOL_REQUESTS_TOTAL = limits.maxProtocolRequestsTotal
  const MAX_SUBCALLS_TOTAL = limits.maxSubcallsTotal
  const MAX_MEMORY_KEY_CHARS = limits.maxMemoryKeyChars
  const MAX_MEMORY_VALUE_CHARS = limits.maxMemoryValueChars
  const pending = new Map<string, Pending>()
  let requestCount = 0
  const portSend = port.postMessage.bind(port)
  const portSubscribe = port.addEventListener.bind(port)

  const sendProtocol = (message: SandboxToHostMessage): void => {
    portSend({ kind: "protocol", message })
  }

  const request = (
    message: Omit<LlmRequestMessage, "id"> | Omit<ContextRequestMessage, "id"> | Omit<MemoryRequestMessage, "id">,
  ): Promise<unknown> => {
    if (requestCount >= MAX_PROTOCOL_REQUESTS_TOTAL) {
      return Promise.reject(new ApiError(
        "BUDGET_EXCEEDED",
        `sandbox request budget exceeded: maximum ${MAX_PROTOCOL_REQUESTS_TOTAL} RPC requests per rlm_exec`,
      ))
    }
    requestCount++
    return new Promise<unknown>((resolve, reject) => {
      const id = randomUUID()
      pending.set(id, { resolve, reject })
      sendProtocol({ ...message, id } as LlmRequestMessage | ContextRequestMessage | MemoryRequestMessage)
    })
  }

  type LlmSettledResult =
    | { ok: true; value: string }
    | { ok: false; error: RlmErrorInfo }
  type LlmFn = ((prompt: string) => Promise<string>) & {
    batch: (prompts: string[]) => Promise<string[]>
    batchSettled: (prompts: string[]) => Promise<LlmSettledResult[]>
  }
  const llm = ((prompt: string): Promise<string> => {
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return Promise.reject(new ApiError("INVALID_ARGUMENT", "llm: prompt must be a non-empty string"))
    }
    return request({ v: PROTOCOL_VERSION, type: "llm", prompt }) as Promise<string>
  }) as LlmFn

  const validateBatchPrompts = (prompts: string[], api: "llm.batch" | "llm.batchSettled"): ApiError | undefined => {
    if (!Array.isArray(prompts) || prompts.length < 1 || prompts.length > MAX_SUBCALLS_TOTAL) {
      return new ApiError("INVALID_ARGUMENT", `${api}: prompts must be an array of 1-${MAX_SUBCALLS_TOTAL} strings`)
    }
    for (const prompt of prompts) {
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        return new ApiError("INVALID_ARGUMENT", `${api}: every prompt must be a non-empty string`)
      }
    }
    return undefined
  }

  llm.batch = (prompts: string[]): Promise<string[]> => {
    const validationError = validateBatchPrompts(prompts, "llm.batch")
    if (validationError) return Promise.reject(validationError)
    return Promise.all(prompts.map((prompt) => request({ v: PROTOCOL_VERSION, type: "llm", prompt }))) as Promise<string[]>
  }

  llm.batchSettled = async (prompts: string[]): Promise<LlmSettledResult[]> => {
    const validationError = validateBatchPrompts(prompts, "llm.batchSettled")
    if (validationError) throw validationError
    return await Promise.all(prompts.map(async (prompt): Promise<LlmSettledResult> => {
      try {
        const value = await request({ v: PROTOCOL_VERSION, type: "llm", prompt }) as string
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: errorInfo(error) }
      }
    }))
  }

  const context = {
    read(path: string): Promise<string> {
      if (typeof path !== "string" || path.trim().length === 0) {
        return Promise.reject(new ApiError("INVALID_ARGUMENT", "context.read: path must be a non-empty string"))
      }
      return request({ v: PROTOCOL_VERSION, type: "context", operation: "read", path }) as Promise<string>
    },
    readMany(paths: string[]): Promise<ReadManyItem[]> {
      if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_READ_MANY_FILES) {
        return Promise.reject(new ApiError("INVALID_ARGUMENT", `context.readMany: paths must be an array of 1-${MAX_READ_MANY_FILES} strings`))
      }
      for (const item of paths) {
        if (typeof item !== "string" || item.trim().length === 0) {
          return Promise.reject(new ApiError("INVALID_ARGUMENT", "context.readMany: every path must be a non-empty string"))
        }
      }
      return request({ v: PROTOCOL_VERSION, type: "context", operation: "readMany", paths }) as Promise<ReadManyItem[]>
    },
    grep(pattern: string): Promise<GrepMatch[]> {
      if (typeof pattern !== "string" || pattern.trim().length === 0) {
        return Promise.reject(new ApiError("INVALID_ARGUMENT", "context.grep: pattern must be a non-empty string"))
      }
      return request({ v: PROTOCOL_VERSION, type: "context", operation: "grep", pattern }) as Promise<GrepMatch[]>
    },
    files(query: string): Promise<string[]> {
      if (typeof query !== "string") return Promise.reject(new ApiError("INVALID_ARGUMENT", "context.files: query must be a string"))
      return request({ v: PROTOCOL_VERSION, type: "context", operation: "files", query }) as Promise<string[]>
    },
    glob(query: string): Promise<string[]> {
      if (typeof query !== "string") return Promise.reject(new ApiError("INVALID_ARGUMENT", "context.glob: query must be a string"))
      return request({ v: PROTOCOL_VERSION, type: "context", operation: "files", query }) as Promise<string[]>
    },
  }

  const checkedMemoryKey = (key: string): string => {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw new ApiError("INVALID_ARGUMENT", "memory key must be a non-empty string")
    }
    if (key.length > MAX_MEMORY_KEY_CHARS) {
      throw new ApiError("BUDGET_EXCEEDED", `memory key exceeds ${MAX_MEMORY_KEY_CHARS} characters`)
    }
    return key
  }

  const memory = {
    async get(key: string): Promise<unknown | undefined> {
      const response = await request({ v: PROTOCOL_VERSION, type: "memory", operation: "get", key: checkedMemoryKey(key) }) as { found?: boolean; value?: unknown }
      return response?.found === true ? response.value : undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      const checkedKey = checkedMemoryKey(key)
      let serialized: string | undefined
      try {
        serialized = safeStringify(value)
      } catch (error) {
        throw new ApiError("INVALID_ARGUMENT", `memory.set: value must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (serialized === undefined) throw new ApiError("INVALID_ARGUMENT", "memory.set: value must be JSON-serializable")
      if (serialized.length > MAX_MEMORY_VALUE_CHARS) {
        throw new ApiError("BUDGET_EXCEEDED", `memory.set: value exceeds ${MAX_MEMORY_VALUE_CHARS} characters`)
      }
      const canonical = JSON.parse(serialized)
      await request({ v: PROTOCOL_VERSION, type: "memory", operation: "set", key: checkedKey, value: canonical })
    },
    delete(key: string): Promise<boolean> {
      return request({ v: PROTOCOL_VERSION, type: "memory", operation: "delete", key: checkedMemoryKey(key) }) as Promise<boolean>
    },
    keys(): Promise<string[]> {
      return request({ v: PROTOCOL_VERSION, type: "memory", operation: "keys" }) as Promise<string[]>
    },
  }

  portSubscribe("message", (event: MessageEvent<unknown>) => {
    const envelope = event.data
    if (!isRecord(envelope) || envelope.kind !== "host" || !isRecord(envelope.message)) {
      sendProtocol({ v: PROTOCOL_VERSION, type: "error", error: { code: "PROTOCOL_ERROR", message: "generated-code worker received invalid host envelope" } })
      return
    }
    const message = envelope.message as unknown as HostToSandboxMessage
    if (message.type !== "llm_result" && message.type !== "context_result" && message.type !== "memory_result") {
      sendProtocol({ v: PROTOCOL_VERSION, type: "error", error: { code: "PROTOCOL_ERROR", message: "generated-code worker received unexpected host message type" } })
      return
    }
    const entry = pending.get(message.id)
    if (!entry) {
      sendProtocol({ v: PROTOCOL_VERSION, type: "error", error: { code: "PROTOCOL_ERROR", message: "generated-code worker received response for unknown request id" } })
      return
    }
    pending.delete(message.id)
    if (message.ok) {
      entry.resolve(message.type === "llm_result" ? message.text : message.value)
    } else {
      entry.reject(new ApiError(message.error?.code ?? "RUNTIME_ERROR", message.error?.message ?? "host request failed"))
    }
  })
  port.start()
  hideAmbientRuntimeGlobals()

  void (async () => {
    try {
      const fn = new Function(
        "llm",
        "context",
        "memory",
        "console",
        "Deno",
        "process",
        "postMessage",
        "addEventListener",
        "close",
        "Worker",
        "MessageChannel",
        "MessagePort",
        "Blob",
        "File",
        "localStorage",
        "caches",
        `"use strict"; return (async () => {\n${code}\n})()`,
      )
      const value = await fn(
        llm,
        context,
        memory,
        quietConsole,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      )
      if (pending.size > 0) {
        throw new ApiError("PROTOCOL_ERROR", `generated code returned with ${pending.size} RPC request(s) still pending; await all llm/context/memory calls`)
      }
      let serialized: string | undefined
      try {
        serialized = safeStringify(value)
      } catch (error) {
        throw new ApiError("RUNTIME_ERROR", `final result is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (serialized === undefined) throw new ApiError("RUNTIME_ERROR", "final result is not JSON-serializable")
      if (serialized.length > MAX_RESULT_CHARS) {
        throw new ApiError("BUDGET_EXCEEDED", `final result exceeds ${MAX_RESULT_CHARS} characters`)
      }
      sendProtocol({ v: PROTOCOL_VERSION, type: "result", value })
    } catch (error) {
      sendProtocol({ v: PROTOCOL_VERSION, type: "error", error: errorInfo(error) })
    }
  })()
}

let bootstrapped = false
subscribeGlobalMessage((event: Event) => {
  if (!(event instanceof MessageEvent) || bootstrapped) return
  const envelope = event.data as BootstrapEnvelope | undefined
  if (!envelope || envelope.kind !== "bootstrap" || typeof envelope.code !== "string" || !(envelope.port instanceof MessagePort) || !validRuntimeLimits(envelope.limits)) return
  bootstrapped = true
  startRuntime(envelope.port, envelope.code, envelope.limits)
})