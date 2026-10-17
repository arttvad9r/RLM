/**
 * RLM plugin — OpenCode V2 entrypoint.
 *
 * Model-generated JavaScript runs inside the zero-permission Deno Worker in
 * rlm-runner/. Host-side context and child-model authority remains bounded by
 * rlm-lib/. This file only binds that audited runtime to OpenCode V2.
 */
import { Plugin } from "@opencode/plugin"
import { RLM_CHILD_SYSTEM_PROMPT, forgetDeletedRlmChild, isRlmChild } from "./rlm-lib/child-system.ts"
import { createOpenCodeV2RlmHost } from "./rlm-lib/opencode-v2.ts"
import { executeRlmExec } from "./rlm-lib/sandbox.ts"
import { executeRlmMap, forgetStructuredMapSession, type RlmMapInput } from "./rlm-lib/structured-map.ts"
import { executeRlmVerify, forgetStructuredVerifySession, type RlmVerifyInput } from "./rlm-lib/structured-verify.ts"
import { turnGovernor } from "./rlm-lib/turn.ts"
import type { Logger, LogLevel } from "./rlm-lib/types.ts"
import { RLM_EXEC_DESCRIPTION, RLM_MAP_DESCRIPTION, RLM_VERIFY_DESCRIPTION } from "./rlm-lib/tool-description.ts"

function consoleMethod(level: LogLevel): "debug" | "info" | "warn" | "error" {
  return level === "debug" || level === "info" || level === "warn" || level === "error" ? level : "info"
}

export default Plugin.define({
  id: "rlm",
  async setup(ctx) {
    const host = createOpenCodeV2RlmHost(ctx)
    const directory = ctx.location.directory
    const worktree = ctx.location.project.canonical
    const cleanup = new AbortController()

    const log: Logger = async (level: LogLevel, message: string, extra: Record<string, unknown> = {}) => {
      try {
        console[consoleMethod(level)](`[rlm] ${message}`, extra)
      } catch {
        // Logging must never break the tool itself.
      }
    }

    const contextRegistration = await ctx.session.hook("context", (request) => {
      if (!isRlmChild(request.sessionID)) return
      request.system.splice(0, request.system.length, { type: "text", text: RLM_CHILD_SYSTEM_PROMPT })
      for (const toolID of Object.keys(request.tools)) delete request.tools[toolID]
    })

    const toolRegistration = await ctx.tool.transform((editor) => {
      editor.add({
        name: "rlm_exec",
        description: RLM_EXEC_DESCRIPTION,
        input: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description:
                "JavaScript code to run in the sandbox. Use `return <value>`, `await llm(...)` / `await llm.batch([...])`, `await context.files/read/readMany/grep(...)`, or turn-scoped `await memory.get/set/delete/keys(...)`.",
            },
          },
          required: ["code"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const code = (input as { code?: unknown }).code
          if (typeof code !== "string") return { content: "rlm_exec: code must be a string" }
          const outcome = await executeRlmExec(host, {
            code,
            parentSessionID: context.sessionID,
            directory,
            worktree,
            messageID: context.messageID,
            abort: context.signal,
            log,
          })
          return { content: outcome.output, metadata: outcome.metadata }
        },
      })

      editor.add({
        name: "rlm_map",
        description: RLM_MAP_DESCRIPTION,
        input: {
          type: "object",
          properties: {
            query: { type: "string", description: "Repository file query passed to the bounded context.files API." },
            instruction: { type: "string", description: "Semantic instruction sent to each partition child. Include the exact required output contract." },
            fanout: { type: "integer", minimum: 1, maximum: 16, default: 4, description: "Number of semantic partitions. Defaults to 4; host concurrency remains capped at 4." },
            output: { type: "string", enum: ["text", "path_list", "candidate_bundle"], default: "text", description: "Deterministic merge mode for child outputs." },
            partition: { type: "string", enum: ["round_robin", "balanced_chars"], default: "round_robin", description: "Deterministic partition strategy. balanced_chars reduces prompt-size skew for uneven files." },
            failureMode: { type: "string", enum: ["strict", "settled"], default: "strict", description: "strict rejects the whole map on child failure; settled preserves successful partitions and reports partitionErrors." },
          },
          required: ["query", "instruction"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const outcome = await executeRlmMap(host, {
            input: input as RlmMapInput,
            parentSessionID: context.sessionID,
            directory,
            worktree,
            messageID: context.messageID,
            abort: context.signal,
            log,
          })
          return { content: outcome.output, metadata: outcome.metadata }
        },
      })

      editor.add({
        name: "rlm_verify",
        description: RLM_VERIFY_DESCRIPTION,
        input: {
          type: "object",
          properties: {
            candidates: { type: "array", items: { type: "string", maxLength: 1024 }, maxItems: 64, description: "Presumptively valid repository paths to conservatively filter." },
            instruction: { type: "string", description: "Positive selection rule. Verifier children may remove a candidate only when its source clearly proves an explicit exception." },
            fanout: { type: "integer", minimum: 1, maximum: 8, default: 4, description: "First-pass verification partitions. Defaults to 4; confirmation uses at most the same number of additional child calls and host concurrency remains capped at 4." },
            partition: { type: "string", enum: ["round_robin", "balanced_chars"], default: "round_robin", description: "Deterministic candidate partition strategy." },
            failureMode: { type: "string", enum: ["strict", "settled"], default: "strict", description: "In settled mode, failed/malformed partitions keep all of their candidates." },
          },
          required: ["candidates", "instruction"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const outcome = await executeRlmVerify(host, {
            input: input as RlmVerifyInput,
            parentSessionID: context.sessionID,
            directory,
            worktree,
            messageID: context.messageID,
            abort: context.signal,
            log,
          })
          return { content: outcome.output, metadata: outcome.metadata }
        },
      })
    })

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: cleanup.signal })) {
          if (event.type !== "session.deleted") continue
          forgetDeletedRlmChild(event.data.sessionID)
          forgetStructuredMapSession(event.data.sessionID)
          forgetStructuredVerifySession(event.data.sessionID)
          turnGovernor.evictSession(event.data.sessionID)
        }
      } catch (error) {
        if (!cleanup.signal.aborted) await log("warn", "event subscription stopped", { error: String(error) })
      }
    })()

    return async () => {
      cleanup.abort()
      await toolRegistration.dispose()
      await contextRegistration.dispose()
    }
  },
})
