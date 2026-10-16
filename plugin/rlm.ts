/**
 * RLM plugin — OpenCode V2 entrypoint.
 *
 * Model-generated JavaScript runs inside the zero-permission Deno Worker in
 * rlm-runner/. Host-side context and child-model authority remains bounded by
 * rlm-lib/. This file only binds that audited runtime to OpenCode V2.
 */
import { Plugin } from "@opencode/plugin"
import { RLM_CHILD_SYSTEM_PROMPT, forgetDeletedRlmChild, isRlmChild } from "./rlm-lib/child-system.ts"
import { createOpenCodeV2RlmClient } from "./rlm-lib/opencode-v2.ts"
import { executeRlmExec } from "./rlm-lib/sandbox.ts"
import { turnGovernor } from "./rlm-lib/turn.ts"
import type { Logger, LogLevel } from "./rlm-lib/types.ts"

const RLM_EXEC_DESCRIPTION =
  "Execute JavaScript in an isolated Deno Worker whose generated-code realm has no filesystem, network, environment, subprocess, or FFI permissions. The trusted transport runner has narrowly scoped read access only to its fixed Worker entry module. All sandbox API calls are async — always await them. API: llm(prompt) -> string (child LLM session with no tools); llm.batch(prompts) -> string[] (array of 1-4 prompts; children run in parallel; results in input order; any failing child rejects the batch); context.files(query) -> string[] (project-relative paths whose path contains the query substring; query \"\" lists all project files); context.read(path) -> string (bounded exact UTF-8 text from the approved workspace; known binary, NUL and invalid UTF-8 content are rejected); context.readMany(paths) -> Array<{path, content?, error?}> (1-64 paths in one call; per-file results in input order; one failing path does not lose the others); context.grep(pattern) -> Array<{path, line, text}> (search matches; regex execution is preempted by a host-owned timeout). Budgets per execution: max 4 llm prompts total (llm() = 1, llm.batch sends prompts.length — shared); max 4 concurrent child calls; max 32 context operations (readMany counts as one); max 64 paths per readMany; prompts up to 32768 chars; total context data 1 MiB; per-file reads capped at 128 KiB, grep at 200 matches, files at 4096 paths; runtime timeout 120s. Budgets per user turn: max 12 rlm_exec (circuit breaker), max 8 child calls, max 96 context operations, max 2 MiB context data, max 180s of rlm_exec wall time. Exceeding a budget or reading outside the workspace returns an explicit error (codes BUDGET_EXCEEDED / CONTEXT_DENIED). llm()/llm.batch() children are stateless semantic workers: they inherit the exact parent OpenCode V2 provider/model but do not inherit AGENTS.md, skills, MCP instructions, repository context, tools, or prior conversation — include any task-specific rules or data the child needs directly in its prompt. Example: const paths = await context.files(\"src/\"); const files = await context.readMany(paths.slice(0, 4)); const summaries = await llm.batch(files.map(function (f) { return \"Summarize: \" + f.content; })); return { count: paths.length, summaries: summaries.length };"

function consoleMethod(level: LogLevel): "debug" | "info" | "warn" | "error" {
  return level === "debug" || level === "info" || level === "warn" || level === "error" ? level : "info"
}

export default Plugin.define({
  id: "rlm",
  async setup(ctx) {
    const client = createOpenCodeV2RlmClient(ctx)
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
                "JavaScript code to run in the sandbox. Use `return <value>`, `await llm(...)` / `await llm.batch([...])`, or `await context.files/read/readMany/grep(...)`.",
            },
          },
          required: ["code"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const code = (input as { code?: unknown }).code
          if (typeof code !== "string") {
            return { content: "rlm_exec: code must be a string" }
          }
          const outcome = await executeRlmExec(client, {
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
    })

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: cleanup.signal })) {
          if (event.type !== "session.deleted") continue
          forgetDeletedRlmChild(event.data.sessionID)
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
