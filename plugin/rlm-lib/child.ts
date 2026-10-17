/**
 * Child LLM / session lifecycle (host side). The single child LLM mechanism:
 * used by rlm_exec's llm()/llm.batch().
 *
 * Behavior:
 *   - child session with parentID = root sessionID, same directory;
 *   - inherits the root provider/model from the exact parent assistant message;
 *   - zero tools: every available tool ID mapped to false;
 *   - blocking session.prompt, text-only extraction, explicit error throw;
 *   - abort linked to the provided AbortSignal;
 *   - child session is intentionally NOT deleted (trace/debugging).
 */
import { RlmError, toErrorInfo } from "./errors.ts"
import { registerRlmChild, unregisterRlmChild } from "./child-system.ts"
import type { ChildLlmInput, ChildLlmResult } from "./host.ts"
import type { Logger } from "./types.ts"

type Client = {
  session: {
    messages: (args: {
      path: { id: string }
      query: { directory: string }
    }) => Promise<{ error?: unknown; data?: Array<{ info: { id?: string; role: string; model?: unknown } }> }>
    create: (args: {
      body: { parentID: string; title: string; model?: { providerID: string; modelID: string; variant?: string } }
      query: { directory: string }
    }) => Promise<{ error?: unknown; data?: { id: string } | null }>
    abort: (args: { path: { id: string }; query: { directory: string } }) => Promise<unknown>
    prompt: (args: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        model: { providerID: string; modelID: string; variant?: string }
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

export async function callChildLlm(
  client: Client,
  input: ChildLlmInput,
  log: Logger,
): Promise<ChildLlmResult> {
  const { prompt, parentSessionID, directory: dir, signal } = input
  let childSessionID: string | undefined

  // 1. Resolve the provider/model from the exact assistant message whose tool
  // call started this rlm_exec. OpenCode V2 stores the selected model on the
  // assistant message, not the user message. The legacy latest-model fallback
  // remains only for direct callers/tests that do not supply that identity.
  const modelRes = await client.session.messages({
    path: { id: parentSessionID },
    query: { directory: dir },
  })
  if (modelRes.error) {
    throw new RlmError("CHILD_FAILED", `failed to read parent messages: ${JSON.stringify(modelRes.error)}`)
  }
  const messages = modelRes.data ?? []
  const modelMessage = input.parentAssistantMessageID
    ? messages.find((m) => m.info.role === "assistant" && m.info.id === input.parentAssistantMessageID)
    : [...messages].reverse().find((m) => m.info.model !== undefined)
  if (input.parentAssistantMessageID && !modelMessage) {
    throw new RlmError("CHILD_FAILED", `could not resolve captured parent assistant message: ${input.parentAssistantMessageID}`)
  }
  const rawModel = modelMessage?.info.model as { providerID?: unknown; modelID?: unknown; variant?: unknown } | undefined
  if (typeof rawModel?.providerID !== "string" || rawModel.providerID.length === 0
    || typeof rawModel?.modelID !== "string" || rawModel.modelID.length === 0) {
    throw new RlmError("CHILD_FAILED", "could not resolve root model from the selected parent assistant message")
  }
  const rootModel = {
    providerID: rawModel.providerID,
    modelID: rawModel.modelID,
    ...(typeof rawModel.variant === "string" && rawModel.variant.length > 0 ? { variant: rawModel.variant } : {}),
  }
  const selectedModel = input.modelOverride
    ? (() => {
        if (!input.modelOverride.provider) {
          throw new RlmError("CHILD_FAILED", "fixed child model requires provider for OpenCode")
        }
        return {
          providerID: input.modelOverride.provider,
          modelID: input.modelOverride.model,
          ...(input.modelOverride.variant ? { variant: input.modelOverride.variant } : {}),
        }
      })()
    : rootModel

  // 2. Full deny tool map: every available tool ID => false. Fail closed when
  //    the server cannot enumerate any tools; adding explicit RLM tool denies
  //    must not make an empty enumeration appear valid. Object.fromEntries uses
  //    data-property creation, so special IDs such as "__proto__" remain own
  //    deny entries instead of invoking Object.prototype setters.
  const toolRes = await client.tool.ids({ query: { directory: dir } })
  if (toolRes.error) {
    throw new RlmError("CHILD_FAILED", `failed to list tool IDs: ${JSON.stringify(toolRes.error)}`)
  }
  const toolIDs = toolRes.data ?? []
  if (toolIDs.length === 0) {
    throw new RlmError("CHILD_FAILED", "tool.ids() returned an empty list; refusing to run child without deny map")
  }
  const denyTools = Object.fromEntries(toolIDs.map((id) => [id, false])) as Record<string, boolean>
  denyTools.rlm_exec = false
  denyTools.rlm_map = false
  denyTools.rlm_verify = false

  // 3. Create child session linked to parent, same directory.
  const childRes = await client.session.create({
    body: { parentID: parentSessionID, title: input.title ?? "rlm child", model: selectedModel },
    query: { directory: dir },
  })
  if (childRes.error || !childRes.data) {
    throw new RlmError("CHILD_FAILED", `failed to create child session: ${JSON.stringify(childRes.error)}`)
  }
  childSessionID = childRes.data.id
  registerRlmChild(childSessionID)
  try {
    await log("info", "child created", {
      childSessionID,
      parentSessionID,
      parentUserMessageID: input.parentUserMessageID,
      model: `${selectedModel.providerID}/${selectedModel.modelID}${selectedModel.variant ? `#${selectedModel.variant}` : ""}`,
      deniedToolCount: Object.keys(denyTools).length,
    })

    const abortChild = () => {
      client.session.abort({ path: { id: childSessionID! }, query: { directory: dir } }).catch(() => {})
    }
    if (signal?.aborted) {
      abortChild()
      throw new RlmError("CHILD_FAILED", "parent aborted before child prompt")
    }
    signal?.addEventListener("abort", abortChild, { once: true })

    try {
      const result = await client.session.prompt({
        path: { id: childSessionID },
        body: {
          parts: [{ type: "text", text: prompt }],
          model: selectedModel,
          tools: denyTools,
        },
        query: { directory: dir },
      })

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
        model: `${selectedModel.providerID}/${selectedModel.modelID}${selectedModel.variant ? `#${selectedModel.variant}` : ""}`,
        deniedToolCount: Object.keys(denyTools).length,
        cost: typeof info?.cost === "number" ? info.cost : undefined,
        tokensInput: info?.tokens?.input,
        tokensOutput: info?.tokens?.output,
        tokensCacheRead: info?.tokens?.cache?.read,
        tokensCacheWrite: info?.tokens?.cache?.write,
      }
    } catch (err) {
      throw err instanceof RlmError ? err : new RlmError("CHILD_FAILED", toErrorInfo(err).message)
    } finally {
      signal?.removeEventListener("abort", abortChild)
    }
  } finally {
    unregisterRlmChild(childSessionID)
  }
}
