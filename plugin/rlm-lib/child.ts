/**
 * Child LLM / session lifecycle (host side). The single child LLM mechanism:
 * used by rlm_exec's llm()/llm.batch().
 *
 * Behavior:
 *   - child session with parentID = root sessionID, same directory;
 *   - inherits the root provider/model from the execution's user message;
 *   - zero tools: every available tool ID mapped to false;
 *   - blocking session.prompt, text-only extraction, explicit error throw;
 *   - abort linked to the provided AbortSignal and settles locally even when
 *     an SDK/provider Promise does not settle after parent cancellation;
 *   - child session is intentionally NOT deleted (trace/debugging).
 */
import {
  MAX_CHILD_RESULT_CHARS,
  MAX_CHILD_TOOL_ID_CHARS,
  MAX_CHILD_TOOL_IDS,
} from "./constants.ts"
import { RlmError, toErrorInfo } from "./errors.ts"
import { registerRlmChild, unregisterRlmChild } from "./child-system.ts"
import { logBestEffort } from "./logging.ts"
import type { Logger } from "./types.ts"

type Client = {
  session: {
    messages: (args: {
      path: { id: string }
      query: { directory: string }
    }) => Promise<{ error?: unknown; data?: Array<{ info: { id?: string; role: string; model?: unknown } }> }>
    create: (args: {
      body: { parentID: string; title: string }
      query: { directory: string }
    }) => Promise<{ error?: unknown; data?: { id: string } | null }>
    abort: (args: { path: { id: string }; query: { directory: string } }) => Promise<unknown>
    prompt: (args: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        model: { providerID: string; modelID: string }
        tools: Record<string, boolean>
      }
      query: { directory: string }
    }) => Promise<{
      error?: unknown
      data?: {
        info?: {
          finish?: string
          cost?: number
          tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } }
          error?: { name?: string; data?: { message?: string } }
        }
        parts?: Array<{ type: string; text?: string; synthetic?: boolean; ignored?: boolean }>
      }
    }>
  }
  tool: {
    ids: (args: { query: { directory: string } }) => Promise<{ error?: unknown; data?: string[] }>
  }
}

export interface ChildLlmInput {
  prompt: string
  parentSessionID: string
  /** User-message identity captured when the parent rlm_exec began. */
  parentUserMessageID?: string
  directory: string
  title?: string
  signal?: AbortSignal
}

export interface ChildLlmResult {
  text: string
  childSessionID: string
  model: string
  deniedToolCount: number
  cost?: number
  tokensInput?: number
  tokensOutput?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function startSdkCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(call())
  } catch (error) {
    return Promise.reject(error)
  }
}

async function awaitPreflightWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  message: string,
): Promise<T> {
  let onAbort: (() => void) | undefined
  try {
    if (!signal) return await promise
    if (signal.aborted) throw new RlmError("CHILD_FAILED", message)
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new RlmError("CHILD_FAILED", message))
      signal.addEventListener("abort", onAbort, { once: true })
    })
    if (signal.aborted) throw new RlmError("CHILD_FAILED", message)
    return await Promise.race([promise, aborted])
  } catch (error) {
    if (error instanceof RlmError) throw error
    throw new RlmError("CHILD_FAILED", toErrorInfo(error).message)
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort)
  }
}

function abortSessionBestEffort(client: Client, sessionID: string, directory: string): void {
  try {
    void Promise.resolve(
      client.session.abort({ path: { id: sessionID }, query: { directory } }),
    ).catch(() => {})
  } catch {
    // Provider cancellation is advisory; local lifecycle settlement is authoritative.
  }
}

function messageInfo(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.info)) return undefined
  return value.info
}

function sdkEnvelopeFailure(stage: string): RlmError {
  // SDK error payloads are opaque/untrusted runtime data. Do not stringify or
  // echo them: cyclic values and BigInt can throw, and arbitrary envelopes may
  // contain credentials or provider-private diagnostics.
  return new RlmError("CHILD_FAILED", stage)
}

export async function callChildLlm(
  client: Client,
  input: ChildLlmInput,
  log: Logger,
): Promise<ChildLlmResult> {
  const { prompt, parentSessionID, directory: dir, signal } = input
  if (signal?.aborted) {
    throw new RlmError("CHILD_FAILED", "parent aborted before child setup")
  }
  let childSessionID: string | undefined

  // 1. Resolve the provider/model from the user message captured by the parent
  // execution. Falling back to the latest user is retained only for direct
  // callers/tests that do not supply parentUserMessageID; production rlm_exec
  // always supplies it so a later user turn cannot switch an in-flight child.
  const modelRes = await awaitPreflightWithAbort(
    startSdkCall(() => client.session.messages({
      path: { id: parentSessionID },
      query: { directory: dir },
    })),
    signal,
    "parent aborted while resolving child model",
  )
  if (!isRecord(modelRes)) {
    throw new RlmError("CHILD_FAILED", "parent messages response was not an object")
  }
  if (modelRes.error) throw sdkEnvelopeFailure("failed to read parent messages")
  if (!Array.isArray(modelRes.data)) {
    throw new RlmError("CHILD_FAILED", "parent messages response did not contain a valid message list")
  }
  const messages = modelRes.data
  let modelInfo: Record<string, unknown> | undefined
  if (input.parentUserMessageID) {
    for (const message of messages) {
      const info = messageInfo(message)
      if (info?.role === "user" && info.id === input.parentUserMessageID) {
        modelInfo = info
        break
      }
    }
  } else {
    for (let index = messages.length - 1; index >= 0; index--) {
      const info = messageInfo(messages[index])
      if (info?.role === "user") {
        modelInfo = info
        break
      }
    }
  }
  if (input.parentUserMessageID && !modelInfo) {
    throw new RlmError("CHILD_FAILED", `could not resolve captured parent user message: ${input.parentUserMessageID}`)
  }
  const rawModel = isRecord(modelInfo?.model) ? modelInfo.model : undefined
  if (typeof rawModel?.providerID !== "string" || rawModel.providerID.length === 0
    || typeof rawModel?.modelID !== "string" || rawModel.modelID.length === 0) {
    throw new RlmError("CHILD_FAILED", "could not resolve root model from the selected parent user message")
  }
  const rootModel = { providerID: rawModel.providerID, modelID: rawModel.modelID }

  // 2. Full deny tool map: every available tool ID => false. Runtime validation
  // is mandatory at this authority boundary; SDK types alone cannot make a
  // malformed provider response safe.
  const toolRes = await awaitPreflightWithAbort(
    startSdkCall(() => client.tool.ids({ query: { directory: dir } })),
    signal,
    "parent aborted while enumerating child tool deny map",
  )
  if (!isRecord(toolRes)) {
    throw new RlmError("CHILD_FAILED", "tool.ids() returned an invalid response object")
  }
  if (toolRes.error) throw sdkEnvelopeFailure("failed to list tool IDs")
  const toolIDs = toolRes.data
  if (!Array.isArray(toolIDs) || toolIDs.length === 0) {
    throw new RlmError("CHILD_FAILED", "tool.ids() returned an invalid or empty list; refusing to run child without deny map")
  }
  if (toolIDs.length > MAX_CHILD_TOOL_IDS) {
    throw new RlmError(
      "CHILD_FAILED",
      `tool.ids() returned ${toolIDs.length} entries and exceeds the safety limit of ${MAX_CHILD_TOOL_IDS}`,
    )
  }
  for (let index = 0; index < toolIDs.length; index++) {
    if (typeof toolIDs[index] !== "string" || toolIDs[index].length === 0 || toolIDs[index].length > MAX_CHILD_TOOL_ID_CHARS) {
      throw new RlmError(
        "CHILD_FAILED",
        `tool.ids() returned an invalid tool id at index ${index}; refusing to run child without deny map`,
      )
    }
  }
  // Object.fromEntries uses data-property creation, so special IDs such as
  // "__proto__" remain own deny entries rather than invoking prototype setters.
  const denyTools = Object.fromEntries(toolIDs.map((id) => [id, false])) as Record<string, boolean>
  denyTools.rlm_exec = false

  // 3. Create child session linked to parent, same directory. If creation wins
  // after a local abort, immediately abort the late child so it cannot be
  // orphaned outside RLM lifecycle accounting.
  const createPromise = startSdkCall(() => client.session.create({
    body: { parentID: parentSessionID, title: input.title ?? "rlm child" },
    query: { directory: dir },
  }))
  let childRes: Awaited<typeof createPromise>
  try {
    childRes = await awaitPreflightWithAbort(
      createPromise,
      signal,
      "parent aborted while creating child session",
    )
  } catch (error) {
    if (signal?.aborted) {
      void createPromise.then((late) => {
        if (!isRecord(late) || !isRecord(late.data)) return
        const lateID = late.data.id
        if (typeof lateID === "string" && lateID.length > 0) {
          abortSessionBestEffort(client, lateID, dir)
        }
      }).catch(() => {})
    }
    throw error
  }
  if (!isRecord(childRes)) {
    throw new RlmError("CHILD_FAILED", "child session creation returned an invalid response object")
  }
  if (childRes.error) throw sdkEnvelopeFailure("failed to create child session")
  const createdID = isRecord(childRes.data) ? childRes.data.id : undefined
  if (typeof createdID !== "string" || createdID.length === 0) {
    throw new RlmError("CHILD_FAILED", "failed to create child session: response did not contain a valid child id")
  }
  childSessionID = createdID
  registerRlmChild(childSessionID)
  try {
    logBestEffort(log, "info", "child created", {
      childSessionID,
      parentSessionID,
      parentUserMessageID: input.parentUserMessageID,
      model: `${rootModel.providerID}/${rootModel.modelID}`,
      deniedToolCount: Object.keys(denyTools).length,
    })

    const abortChild = () => abortSessionBestEffort(client, childSessionID!, dir)
    if (signal?.aborted) {
      abortChild()
      throw new RlmError("CHILD_FAILED", "parent aborted before child prompt")
    }

    let rejectAbort: ((error: Error) => void) | undefined
    let abortHandled = false
    const abortPromise = signal
      ? new Promise<never>((_, reject) => { rejectAbort = reject })
      : undefined
    const onAbort = () => {
      if (abortHandled) return
      abortHandled = true
      abortChild()
      rejectAbort?.(new RlmError("CHILD_FAILED", "parent aborted during child prompt"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    if (signal?.aborted) onAbort()

    try {
      const promptPromise = startSdkCall(() => client.session.prompt({
        path: { id: childSessionID! },
        body: {
          parts: [{ type: "text", text: prompt }],
          model: rootModel,
          tools: denyTools,
        },
        query: { directory: dir },
      }))
      const result = abortPromise
        ? await Promise.race([promptPromise, abortPromise])
        : await promptPromise

      if (!isRecord(result)) {
        throw new RlmError("CHILD_FAILED", "child session returned an invalid response object")
      }
      if (result.error) throw sdkEnvelopeFailure("child session returned an SDK error envelope")
      const data = isRecord(result.data) ? result.data : undefined
      const info = isRecord(data?.info) ? data.info : undefined
      logBestEffort(log, "info", "child prompt completed", {
        childSessionID,
        finish: info?.finish,
        cost: info?.cost,
      })

      const infoError = isRecord(info?.error) ? info.error : undefined
      if (infoError) {
        throw new RlmError(
          "CHILD_FAILED",
          `child session failed (${typeof infoError.name === "string" ? infoError.name : "error"})`,
        )
      }

      const parts = Array.isArray(data?.parts) ? data.parts : []
      const textParts: string[] = []
      let textChars = 0
      for (const part of parts) {
        if (!isRecord(part)
          || part.type !== "text"
          || part.synthetic === true
          || part.ignored === true
          || typeof part.text !== "string") continue
        const separatorChars = textParts.length > 0 ? 1 : 0
        if (textChars + separatorChars + part.text.length > MAX_CHILD_RESULT_CHARS) {
          throw new RlmError("BUDGET_EXCEEDED", `llm result exceeds ${MAX_CHILD_RESULT_CHARS} characters`)
        }
        textParts.push(part.text)
        textChars += separatorChars + part.text.length
      }
      const text = textParts.join("\n").trim()
      if (!text) {
        throw new RlmError(
          "CHILD_FAILED",
          `child finished (${typeof info?.finish === "string" ? info.finish : "unknown"}) without returning any text`,
        )
      }

      const tokens = isRecord(info?.tokens) ? info.tokens : undefined
      return {
        text,
        childSessionID,
        model: `${rootModel.providerID}/${rootModel.modelID}`,
        deniedToolCount: Object.keys(denyTools).length,
        cost: typeof info?.cost === "number" ? info.cost : undefined,
        tokensInput: typeof tokens?.input === "number" ? tokens.input : undefined,
        tokensOutput: typeof tokens?.output === "number" ? tokens.output : undefined,
      }
    } catch (err) {
      throw err instanceof RlmError ? err : new RlmError("CHILD_FAILED", toErrorInfo(err).message)
    } finally {
      signal?.removeEventListener("abort", onAbort)
    }
  } finally {
    unregisterRlmChild(childSessionID)
  }
}
