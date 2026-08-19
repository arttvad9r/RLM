/**
 * RLM plugin — thin entrypoint.
 *
 * All logic lives in rlm-lib/ modules:
 *   - rlm-lib/child.ts      child LLM / session lifecycle
 *   - rlm-lib/context.ts    context operations (read/readMany/grep/files)
 *   - rlm-lib/workspace.ts  workspace root resolution + path confinement
 *   - rlm-lib/sandbox.ts    sandbox execution / run lifecycle
 *   - rlm-lib/turn.ts       per-user-turn budget governor
 *   - rlm-lib/protocol.ts   protocol v1 framing + validation
 *   - rlm-lib/types.ts      message types, error codes, RlmRunState
 *   - rlm-lib/errors.ts     RlmError with stable codes
 *   - rlm-lib/constants.ts  limits/constants
 *   - rlm-runner/runner.ts  trusted Deno transport
 *   - rlm-runner/generated-worker.ts zero-permission generated-code realm
 *
 * rlm_exec
 *   Runs model-generated JavaScript inside a Deno Worker with permissions
 *   revoked. The trusted transport process has narrowly scoped read access
 *   only to its fixed Worker entry module. The generated program gets host
 *   functions `llm`/`llm.batch` (on top of callChildLlm) and read-only
 *   `context.*` helpers plus JS built-ins; no OpenCode client, session IDs,
 *   filesystem handles, or process handles are exposed. Communication is a
 *   versioned protocol over authenticated host/runner frames and a private
 *   runner/Worker MessagePort. A host-controlled watchdog kills the sandbox
 *   on hang; a per-user-turn governor caps rlm_exec/child/wall budgets.
 *
 * The child LLM mechanism (callChildLlm in rlm-lib/child.ts) is internal and
 * used only by rlm_exec's llm()/llm.batch() — there is no public rlm_call
 * tool in the root agent's toolset.
 */
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { RLM_CHILD_SYSTEM_PROMPT, isRlmChild } from "./rlm-lib/child-system.ts"
import { executeRlmExec } from "./rlm-lib/sandbox.ts"
import { turnGovernor } from "./rlm-lib/turn.ts"
import type { Logger, LogLevel } from "./rlm-lib/types.ts"

const RLM_EXEC_DESCRIPTION =
  "Execute JavaScript in an isolated Deno Worker whose generated-code realm has no filesystem, network, environment, subprocess, or FFI permissions. The trusted transport runner has narrowly scoped read access only to its fixed Worker entry module. All sandbox API calls are async — always await them. API: llm(prompt) -> string (child LLM session with no tools); llm.batch(prompts) -> string[] (array of 1-4 prompts; children run in parallel; results in input order; any failing child rejects the batch); context.files(query) -> string[] (project-relative paths whose path contains the query substring; query \"\" lists all project files); context.read(path) -> string (bounded exact UTF-8 text from the approved workspace; known binary, NUL and invalid UTF-8 content are rejected); context.readMany(paths) -> Array<{path, content?, error?}> (1-64 paths in one call; per-file results in input order; one failing path does not lose the others); context.grep(pattern) -> Array<{path, line, text}> (search matches; regex execution is preempted by a host-owned timeout). Budgets per execution: max 4 llm prompts total (llm() = 1, llm.batch sends prompts.length — shared); max 4 concurrent child calls; max 32 context operations (readMany counts as one); max 64 paths per readMany; prompts up to 32768 chars; total context data 1 MiB; per-file reads capped at 128 KiB, grep at 200 matches, files at 4096 paths; runtime timeout 120s. Budgets per user turn: max 12 rlm_exec (circuit breaker), max 8 child calls, max 96 context operations, max 2 MiB context data, max 180s of rlm_exec wall time. Exceeding a budget or reading outside the workspace returns an explicit error (codes BUDGET_EXCEEDED / CONTEXT_DENIED). llm()/llm.batch() children are stateless semantic workers: they inherit the root provider/model supported by the pinned OpenCode SDK but do not inherit AGENTS.md, skills, MCP instructions, repository context, tools, or prior conversation — include any task-specific rules or data the child needs directly in its prompt. Example: const paths = await context.files(\"src/\"); const files = await context.readMany(paths.slice(0, 4)); const summaries = await llm.batch(files.map(function (f) { return \"Summarize: \" + f.content; })); return { count: paths.length, summaries: summaries.length };"

export default (async ({ client, directory, worktree }) => {
  const log: Logger = async (level: LogLevel, message: string, extra: Record<string, unknown> = {}) => {
    try {
      await client.app.log({
        body: { service: "rlm", level, message: `[rlm] ${message}`, extra },
        query: { directory },
      })
    } catch {
      // Logging must never break the tool itself.
    }
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.deleted") turnGovernor.evictSession(event.properties.info.id)
    },
    "experimental.chat.system.transform": async (
      input: { sessionID?: string },
      output: { system: string[] },
    ) => {
      const sid = input.sessionID
      if (sid && isRlmChild(sid)) {
        output.system.splice(0, output.system.length, RLM_CHILD_SYSTEM_PROMPT)
      }
    },
    tool: {
      rlm_exec: tool({
        description: RLM_EXEC_DESCRIPTION,
        args: {
          code: tool.schema
            .string()
            .describe(
              "JavaScript code to run in the sandbox. Use `return <value>`, `await llm(...)` / `await llm.batch([...])`, or `await context.files/read/readMany/grep(...)`.",
            ),
        },
        async execute({ code }, context) {
          const outcome = await executeRlmExec(client, {
            code,
            parentSessionID: context.sessionID,
            directory,
            worktree,
            messageID: context.messageID,
            abort: context.abort,
            log,
          })
          context.metadata({ metadata: outcome.metadata })
          return outcome.output
        },
      }),
    },
  }
}) satisfies Plugin
