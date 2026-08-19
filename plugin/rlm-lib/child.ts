/**
 * Child LLM / session lifecycle (host side). The single child LLM mechanism:
 * used by rlm_exec's llm()/llm.batch().
 *
 * Behavior:
 *   - child session with parentID = root sessionID, same directory;
 *   - inherits the root provider/model from the user message that owns the
 *     active RLM turn, never from a later user message that arrived meanwhile;
 *   - zero tools: every available tool ID mapped to false;
 *   - blocking session.prompt, text-only extraction, explicit error throw;
 *   - abort linked to the provided AbortSignal and settles locally even if
 *     preflight SDK reads/creation or the underlying prompt Promise do not
 *     settle after parent abort;
 *   - child session is intentionally NOT deleted (trace/debugging).
 */
import { RlmError, toErrorInfo } from "./errors.ts"
import { registerRlmChild, unregisterRlmChild } from "./child-system.ts"
import { turnGovernor } from "./turn.ts"
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
  directory: string
  title?: string
  signal?: AbortSignal
  /** Internal test seam; production resolves the active turn from TurnGovernor. */
  parentTurnID?: string
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

async function awaitPreflightWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  message: string,
): Promise<T> {
  if (!signal) return await promise
  if (signal.aborted) throw new RlmError("CHILD_FAILED", message)
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new RlmError("CHILD_FAILED", message))
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort)
  }
}

export async function callChildLlm(
  client: Client,
  input: ChildLlmInput,
  log: Logger,
): Promise<ChildLlmResult> {
  const { prompt, parentSessionID, directory: dir, signal } = input
  let childSessionID: string | undefined
  // Preserve #21's existing pre-aborted behavior: when the call starts already
  // aborted, allow setup to reach the child so the provider-side abort path can
  // clean it. For an abort that occurs during setup, settle locally instead of
  // depending on read/create provider promises to finish.
  const preflightSignal = signal?.aborted ? undefined : signal

  // 1. Resolve the provider/model supported by the pinned SDK from the exact
  // user turn already authorized for this rlm_exec. A newer user message can
  // arrive while the sandbox is still running, so selecting the globally last
  // user message would cross the execution's turn boundary.
  const parentTurnID = input.parentTurnID ?? turnGovernor.snapshot(parentSessionID)?.turnId
  if (!parentTurnID) {
    throw new RlmError("CHILD_FAILED", "could not resolve active RLM user turn for child model inheritance")
  }
  const modelRes = await awaitPreflightWithAbort(
    client.session.messages({
      path: { id: parentSessionID },
      query: { directory: dir },
    }),
    preflightSignal,
    "parent aborted while resolving child model",
  )
  if (modelRes.error) {
    throw new RlmError("CHILD_FAILED", `failed to read parent messages: ${JSON.stringify(modelRes.error)}`)
  }
  const rootUser = (modelRes.data ?? []).find((message) => (
    message.info.role === "user" && message.info.id === parentTurnID
  ))
  const rawModel = rootUser?.info.model as { providerID: string; modelID: string } | undefined
  if (!rawModel?.providerID || !rawModel?.modelID) {
    throw new RlmError("CHILD_FAILED", `could not resolve root model for RLM user turn ${parentTurnID}`)
  }
  const rootModel = { providerID: rawModel.providerID, modelID: rawModel.modelID }

  // 2. Full deny tool map: every available tool ID => false. Fail closed when
  //    the server cannot enumerate a runtime-valid string inventory; adding
  //    the explicit rlm_exec deny must not make malformed/empty data appear
  //    like a valid full deny map.
  const toolRes = await awaitPreflightWithAbort(
    client.tool.ids({ query: { directory: dir } }),
    preflightSignal,
    "parent aborted while enumerating child tool deny map",
  )
  if (toolRes.error) {
    throw new RlmError("CHILD_FAILED", `failed to list tool IDs: ${JSON.stringify(toolRes.error)}`)
  }
  const toolIDs = toolRes.data
  if (!Array.isArray(toolIDs) || toolIDs.length === 0) {
    throw new RlmError("CHILD_FAILED", "tool.ids() returned an invalid or empty list; refusing to run child without deny map")
  }
  for (let index = 0; index < toolIDs.length; index++) {
    if (typeof toolIDs[index] !== "string" || toolIDs[index].length === 0) {
      throw new RlmError(
        "CHILD_FAILED",
        `tool.ids() returned an invalid tool id at index ${index}; refusing to run child without deny map`,
      )
    }
  }
  const denyTools: Record<string, boolean> = {}
  for (const id of toolIDs) denyTools[id] = false
  denyTools.rlm_exec = false

  // 3. Create child session linked to parent, same directory. If parent aborts
  // while create is still pending, settle the RLM call locally. A late-created
  // session is immediately provider-aborted once its ID eventually arrives so
  // the local early return cannot orphan a live child.
  const createPromise = client.session.create({
    body: { parentID: parentSessionID, title: input.title ?? "rlm child" },
    query: { directory: dir },
  })
  let childRes: Awaited<typeof createPromise>
  try {
    childRes = await awaitPreflightWithAbort(
      createPromise,
      preflightSignal,
      "parent aborted while creating child session",
    )
  } catch (error) {
    if (preflightSignal?.aborted) {
      void createPromise.then((late) => {
        const lateID = late.data?.id
        if (typeof lateID === "string" && lateID.length > 0) {
          return client.session.abort({ path: { id: lateID }, query: { directory: dir } }).catch(() => {})
        }
      }).catch(() => {})
    }
    throw error
  }
  if (childRes.error || !childRes.data) {
    throw new RlmError("CHILD_FAILED", `failed to create child session: ${JSON.stringify(childRes.error)}`)
  }
  childSessionID = childRes.data.id
  registerRlmChild(childSessionID)
  try {
    await log("info", "child created", {
      childSessionID,
      parentSessionID,
      model: `${rootModel.providerID}/${rootModel.modelID}`,
      deniedToolCount: Object.keys(denyTools).length,
    })

    const abortChild = () => {
      client.session.abort({ path: { id: childSessionID! }, query: { directory: dir } }).catch(() => {})
    }
    if (signal?.aborted) {
      abortChild()
      throw new RlmError("CHILD_FAILED", "parent aborted before child prompt")
    }
    let rejectAbort: ((error: Error) => void) | undefined
    const abortPromise = signal
      ? new Promise<never>((_, reject) => { rejectAbort = reject })
      : undefined
    const onAbort = () => {
      abortChild()
      rejectAbort?.(new RlmError("CHILD_FAILED", "parent aborted during child prompt"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    try {
      const promptPromise = client.session.prompt({
        path: { id: childSessionID },
        body: {
          parts: [{ type: "text", text: prompt }],
          model: rootModel,
          tools: denyTools,
        },
        query: { directory: dir },
      })
      const result = abortPromise
        ? await Promise.race([promptPromise, abortPromise])
        : await promptPromise

      if (result.error) {
        throw new RlmError("CHILD_FAILED", `child session error: ${JSON.stringify(result.error)}`)
      }
      await log("info", "child prompt completed", {
        childSessionID,
        finish: result.data?.info?.finish,
        cost: result.data?.info?.cost,
      })

      const infoError = result.data?.info?.error as { name?: string; data?: { message?: string } } | undefined
      if (infoError) {
        throw new RlmError(
          "CHILD_FAILED",
          `child session failed (${infoError.name ?? "error"}): ${infoError.data?.message ?? JSON.stringify(infoError)}`,
        )
      }

      const text = (result.data?.parts ?? [])
        .filter((p) => p.type === "text" && !p.synthetic && !p.ignored)
        .map((p) => p.text ?? "")
        .join("\n")
        .trim()
      if (!text) {
        throw new RlmError("CHILD_FAILED", `child finished (${result.data?.info?.finish ?? "unknown"}) without returning any text`)
      }

      const info = result.data?.info
      return {
        text,
        childSessionID,
        model: `${rootModel.providerID}/${rootModel.modelID}`,
        deniedToolCount: Object.keys(denyTools).length,
        cost: typeof info?.cost === "number" ? info.cost : undefined,
        tokensInput: info?.tokens?.input,
        tokensOutput: info?.tokens?.output,
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
