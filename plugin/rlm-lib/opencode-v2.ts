import type { Plugin } from "@opencode/plugin"
import { isAbsolute, join } from "node:path"
import { callChildLlm } from "./child.ts"
import { RlmError } from "./errors.ts"

interface LegacyModelRef {
  providerID: string
  modelID: string
  variant?: string
}

interface LegacySessionMessage {
  info: {
    id?: string
    role: string
    model?: LegacyModelRef
  }
}

interface LegacyPromptResult {
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
}

function errorResult(error: unknown): { error: unknown } {
  return { error }
}

function legacyMessages(messages: Awaited<ReturnType<Plugin.Context["session"]["context"]>>): LegacySessionMessage[] {
  return messages.map((message) => {
    if (message.type === "assistant") {
      return {
        info: {
          id: message.id,
          role: "assistant",
          model: {
            providerID: message.model.providerID,
            modelID: message.model.id,
            ...(message.model.variant ? { variant: message.model.variant } : {}),
          },
        },
      }
    }
    return { info: { id: message.id, role: message.type } }
  })
}

function assistantToLegacy(message: Extract<Awaited<ReturnType<Plugin.Context["session"]["context"]>>[number], { type: "assistant" }>): LegacyPromptResult {
  return {
    data: {
      info: {
        finish: message.finish,
        cost: message.cost,
        tokens: {
          input: message.tokens?.input,
          output: message.tokens?.output,
          cache: message.tokens?.cache,
        },
        error: message.error
          ? { name: message.error.type, data: { message: message.error.message } }
          : undefined,
      },
      parts: message.content
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => ({ type: "text", text: part.text })),
    },
  }
}

/**
 * Adapter from OpenCode V2's promise plugin API to the narrow host interface
 * used by the audited RLM runtime. Keeping this boundary small lets the Deno
 * sandbox and budget code remain independent from OpenCode API churn.
 */
export function createOpenCodeV2RlmClient(ctx: Plugin.Context) {
  return {
    session: {
      messages: async ({ path }: { path: { id: string }; query: { directory: string } }) => {
        try {
          return { data: legacyMessages(await ctx.session.context({ sessionID: path.id })) }
        } catch (error) {
          return errorResult(error)
        }
      },
      create: async ({ body }: {
        body: { parentID: string; title: string; model?: LegacyModelRef }
        query: { directory: string }
      }) => {
        try {
          const session = await ctx.session.create({
            parentID: body.parentID,
            title: body.title,
            model: body.model
              ? { providerID: body.model.providerID, id: body.model.modelID, ...(body.model.variant ? { variant: body.model.variant } : {}) }
              : undefined,
            location: { directory: ctx.location.directory },
            permissions: [{ action: "*", resource: "*", effect: "deny" }],
          })
          return { data: { id: session.id } }
        } catch (error) {
          return errorResult(error)
        }
      },
      abort: async ({ path }: { path: { id: string }; query: { directory: string } }) => {
        try {
          await ctx.session.interrupt({ sessionID: path.id })
          return {}
        } catch (error) {
          return errorResult(error)
        }
      },
      prompt: async ({ path, body }: {
        path: { id: string }
        body: {
          parts: Array<{ type: "text"; text: string }>
          model: LegacyModelRef
          tools: Record<string, boolean>
        }
        query: { directory: string }
      }): Promise<LegacyPromptResult> => {
        try {
          const promptText = body.parts.map((part) => part.text).join("\n")
          const inbox = await ctx.session.prompt({ sessionID: path.id, text: promptText })
          await ctx.session.wait({ sessionID: path.id })
          const messages = await ctx.session.context({ sessionID: path.id })
          const userIndex = messages.findIndex((message) => message.id === inbox.id)
          const search = userIndex >= 0 ? messages.slice(userIndex + 1) : messages
          const assistant = [...search].reverse().find((message) => message.type === "assistant")
          if (!assistant || assistant.type !== "assistant") {
            return errorResult(new Error("child session completed without an assistant response"))
          }
          return assistantToLegacy(assistant)
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    tool: {
      ids: async (_args: { query: { directory: string } }) => {
        try {
          return { data: (await ctx.tool.list()).map((entry) => entry.id) }
        } catch (error) {
          return errorResult(error)
        }
      },
    },
    file: {},
  }
}

/** Host-neutral adapter consumed by the shared RLM runtime. */
export function createOpenCodeV2RlmHost(ctx: Plugin.Context): import("./host.ts").RlmHost {
  const client = createOpenCodeV2RlmClient(ctx)
  const configHome = process.env.XDG_CONFIG_HOME?.trim()
  const hostConfigFallbackFile = configHome && isAbsolute(configHome)
    ? join(configHome, "opencode", "agents", ".rlm-host.json")
    : undefined
  return {
    adapter: "opencode-v2",
    hostConfigFallbackFile,
    resolveTurn: async ({ sessionID, directory, boundaryID }) => {
      const result = await client.session.messages({ path: { id: sessionID }, query: { directory } })
      if ("error" in result) {
        throw new RlmError("RUNTIME_ERROR", "failed to resolve OpenCode RLM turn from parent session messages")
      }
      const messages = result.data ?? []
      const boundaryIndex = messages.findIndex((message) => message.info.id === boundaryID)
      if (boundaryIndex < 0) {
        throw new RlmError("RUNTIME_ERROR", `OpenCode RLM boundary message not found: ${boundaryID}`)
      }
      if (messages[boundaryIndex]?.info.role !== "assistant") {
        throw new RlmError("RUNTIME_ERROR", `OpenCode RLM boundary is not an assistant message: ${boundaryID}`)
      }
      const boundaryModel = messages[boundaryIndex]?.info.model
      const rootModel = boundaryModel
        ? `${boundaryModel.providerID}/${boundaryModel.modelID}${boundaryModel.variant ? `#${boundaryModel.variant}` : ""}`
        : undefined
      for (let index = boundaryIndex - 1; index >= 0; index--) {
        const info = messages[index]?.info
        if (info?.role === "user" && typeof info.id === "string" && info.id.length > 0) {
          return { turnId: info.id, boundaryId: boundaryID, order: boundaryIndex, ...(rootModel ? { rootModel } : {}) }
        }
      }
      throw new RlmError("RUNTIME_ERROR", `OpenCode RLM boundary ${boundaryID} has no preceding user message`)
    },
    callChild: (input, log) => callChildLlm(client, input, log),
  }
}
