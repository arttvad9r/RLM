import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { RLM_CHILD_SYSTEM_PROMPT } from "../../plugin/rlm-lib/child-system.js";
import { RlmError } from "../../plugin/rlm-lib/errors.js";
const MAX_CODEX_STDOUT_CHARS = 1024 * 1024;
const MAX_CODEX_STDERR_CHARS = 64 * 1024;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requiredString(value, name) {
    if (typeof value !== "string" || value.length === 0) {
        throw new RlmError("RUNTIME_ERROR", `Codex MCP metadata is missing ${name}`);
    }
    return value;
}
function parseTurnMetadata(raw) {
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            if (isRecord(parsed))
                return parsed;
        }
        catch {
            // Fail below with one stable diagnostic.
        }
    }
    if (isRecord(raw))
        return raw;
    throw new RlmError("RUNTIME_ERROR", "Codex MCP metadata is missing x-codex-turn-metadata");
}
/** Validate only host-owned Codex metadata; tool arguments never select workspace or turn authority. */
export function parseCodexInvocationContext(meta, cwd = process.cwd()) {
    if (!isRecord(meta))
        throw new RlmError("RUNTIME_ERROR", "Codex MCP request metadata is unavailable");
    const threadId = requiredString(meta.threadId, "threadId");
    const turn = parseTurnMetadata(meta["x-codex-turn-metadata"]);
    const turnId = requiredString(turn.turn_id, "turn_id");
    const metadataThreadId = turn.thread_id;
    if (metadataThreadId !== undefined && metadataThreadId !== threadId) {
        throw new RlmError("RUNTIME_ERROR", "Codex MCP thread identity mismatch");
    }
    const started = turn.turn_started_at_unix_ms;
    if (!Number.isSafeInteger(started) || Number(started) <= 0) {
        throw new RlmError("RUNTIME_ERROR", "Codex MCP metadata is missing a valid turn_started_at_unix_ms");
    }
    const model = requiredString(turn.model, "model");
    const reasoningEffort = typeof turn.reasoning_effort === "string" && turn.reasoning_effort.length > 0
        ? turn.reasoning_effort
        : undefined;
    if (!isRecord(turn.workspaces)) {
        throw new RlmError("RUNTIME_ERROR", "Codex MCP metadata is missing workspaces");
    }
    const workspacePaths = Object.keys(turn.workspaces);
    if (workspacePaths.length === 0 || workspacePaths.some((entry) => !isAbsolute(entry))) {
        throw new RlmError("RUNTIME_ERROR", "Codex MCP workspaces must contain absolute paths");
    }
    const workspaceRoot = workspacePaths.length === 1
        ? workspacePaths[0]
        : workspacePaths.includes(cwd) ? cwd : undefined;
    if (!workspaceRoot) {
        throw new RlmError("RUNTIME_ERROR", "Codex MCP request has multiple workspaces and the server cwd does not identify the active workspace");
    }
    return {
        threadId,
        turnId,
        turnStartedAtUnixMs: Number(started),
        model,
        reasoningEffort,
        workspaceRoot,
    };
}
export function codexChildArgs(context, cwd, model = context.model, reasoningEffort = context.reasoningEffort) {
    const args = [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--json",
        "--color",
        "never",
        "--sandbox",
        "read-only",
        "-C",
        cwd,
        "-m",
        model,
        "-c",
        'default_permissions="rlm_child"',
        "-c",
        'permissions.rlm_child.filesystem={"/"="deny"}',
        "-c",
        "permissions.rlm_child.network.enabled=false",
        "-c",
        "permissions.rlm_child.allow_login_shell=false",
        "-c",
        'approval_policy="never"',
        "-c",
        "project_doc_max_bytes=0",
        "-c",
        "agents.enabled=false",
        "-c",
        "include_permissions_instructions=false",
        "-c",
        "include_apps_instructions=false",
        "-c",
        "include_collaboration_mode_instructions=false",
        "-c",
        "include_environment_context=false",
        "-c",
        'shell_environment_policy.inherit="none"',
        "-c",
        `base_instructions=${JSON.stringify(RLM_CHILD_SYSTEM_PROMPT)}`,
    ];
    if (reasoningEffort) {
        args.push("-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
    }
    // A lone '-' makes Codex read exactly one prompt from stdin. The adapter closes
    // stdin immediately after writing so PTY/inherited-stdin state cannot stall it.
    args.push("-");
    return args;
}
export function parseCodexChildJsonl(stdout) {
    let threadId;
    let finalText;
    let tokensInput;
    let tokensOutput;
    let turnCompleted = false;
    for (const rawLine of stdout.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line)
            continue;
        let event;
        try {
            const parsed = JSON.parse(line);
            if (!isRecord(parsed))
                throw new Error("event is not an object");
            event = parsed;
        }
        catch {
            throw new RlmError("CHILD_FAILED", "Codex child emitted malformed JSONL");
        }
        if (event.type === "thread.started" && typeof event.thread_id === "string") {
            threadId = event.thread_id;
            continue;
        }
        if (event.type === "item.completed" && isRecord(event.item)
            && event.item.type === "agent_message" && typeof event.item.text === "string") {
            finalText = event.item.text;
            continue;
        }
        if (event.type === "turn.completed") {
            turnCompleted = true;
            if (isRecord(event.usage)) {
                if (typeof event.usage.input_tokens === "number")
                    tokensInput = event.usage.input_tokens;
                if (typeof event.usage.output_tokens === "number")
                    tokensOutput = event.usage.output_tokens;
            }
        }
    }
    if (!threadId)
        throw new RlmError("CHILD_FAILED", "Codex child completed without thread.started");
    if (!finalText?.trim())
        throw new RlmError("CHILD_FAILED", "Codex child completed without a final agent message");
    if (!turnCompleted)
        throw new RlmError("CHILD_FAILED", "Codex child completed without turn.completed");
    return { threadId, text: finalText.trim(), tokensInput, tokensOutput };
}
function appendBounded(current, chunk, limit) {
    const next = current + String(chunk);
    if (next.length <= limit)
        return { value: next, overflow: false };
    return { value: next.slice(0, limit), overflow: true };
}
export class CodexRlmHost {
    adapter = "codex-mcp";
    context;
    codexExecutable;
    get rootModel() {
        return `codex/${this.context.model}${this.context.reasoningEffort ? `#${this.context.reasoningEffort}` : ""}`;
    }
    constructor(context, codexExecutable = process.env.RLM_CODEX_EXECUTABLE || "codex") {
        this.context = context;
        this.codexExecutable = codexExecutable;
    }
    async resolveTurn(input) {
        if (input.sessionID !== this.context.threadId || input.boundaryID !== this.context.turnId) {
            throw new RlmError("RUNTIME_ERROR", "Codex RLM turn identity changed before execution");
        }
        if (input.directory !== this.context.workspaceRoot) {
            throw new RlmError("RUNTIME_ERROR", "Codex RLM workspace identity changed before execution");
        }
        return {
            turnId: this.context.turnId,
            boundaryId: this.context.turnId,
            order: this.context.turnStartedAtUnixMs,
        };
    }
    async callChild(input, log) {
        if (input.signal?.aborted)
            throw new RlmError("CHILD_FAILED", "parent aborted before Codex child start");
        const childDir = await mkdtemp(join(tmpdir(), "rlm-codex-child-"));
        if (input.modelOverride?.provider && input.modelOverride.provider !== "openai" && input.modelOverride.provider !== "codex") {
            throw new RlmError("CHILD_FAILED", `Codex adapter cannot resolve fixed child provider: ${input.modelOverride.provider}`);
        }
        const childModel = input.modelOverride?.model ?? this.context.model;
        const childReasoningEffort = input.modelOverride?.variant ?? this.context.reasoningEffort;
        const args = codexChildArgs(this.context, childDir, childModel, childReasoningEffort);
        let stdout = "";
        let stderr = "";
        let stdoutOverflow = false;
        let stderrOverflow = false;
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");
        try {
            const child = spawn(this.codexExecutable, args, {
                cwd: childDir,
                env: process.env,
                stdio: ["pipe", "pipe", "pipe"],
            });
            const abortChild = () => child.kill("SIGKILL");
            input.signal?.addEventListener("abort", abortChild, { once: true });
            child.stdout.on("data", (chunk) => {
                const next = appendBounded(stdout, stdoutDecoder.write(chunk), MAX_CODEX_STDOUT_CHARS);
                stdout = next.value;
                if (next.overflow) {
                    stdoutOverflow = true;
                    child.kill("SIGKILL");
                }
            });
            child.stderr.on("data", (chunk) => {
                const next = appendBounded(stderr, stderrDecoder.write(chunk), MAX_CODEX_STDERR_CHARS);
                stderr = next.value;
                stderrOverflow ||= next.overflow;
            });
            const exitPromise = new Promise((resolve, reject) => {
                child.once("error", reject);
                child.once("exit", (code, signal) => resolve({ code, signal }));
            });
            const stdinPromise = new Promise((resolve) => {
                let settled = false;
                const settle = (error) => {
                    if (settled)
                        return;
                    settled = true;
                    resolve(error);
                };
                child.stdin.once("error", (error) => settle(error));
                child.stdin.once("finish", () => settle());
                child.stdin.once("close", () => settle());
            });
            child.stdin.end(input.prompt);
            const [exited, stdinError] = await Promise.all([exitPromise, stdinPromise])
                .finally(() => input.signal?.removeEventListener("abort", abortChild));
            stdout = appendBounded(stdout, stdoutDecoder.end(), MAX_CODEX_STDOUT_CHARS).value;
            stderr = appendBounded(stderr, stderrDecoder.end(), MAX_CODEX_STDERR_CHARS).value;
            if (input.signal?.aborted)
                throw new RlmError("CHILD_FAILED", "Codex child aborted with parent rlm_exec");
            if (stdinError)
                throw new RlmError("CHILD_FAILED", `Codex child stdin failed: ${stdinError.message}`);
            if (stdoutOverflow)
                throw new RlmError("CHILD_FAILED", `Codex child JSONL exceeds ${MAX_CODEX_STDOUT_CHARS} characters`);
            if (exited.code !== 0) {
                await log("warn", "Codex child exited unsuccessfully", {
                    exit: String(exited.code ?? exited.signal ?? "unknown"),
                    stderrChars: stderr.length,
                });
                throw new RlmError("CHILD_FAILED", `Codex child exited with ${String(exited.code ?? exited.signal ?? "unknown")}`);
            }
            if (stderrOverflow)
                await log("warn", "Codex child stderr was truncated");
            const parsed = parseCodexChildJsonl(stdout);
            await log("info", "Codex child completed", {
                childSessionID: parsed.threadId,
                parentSessionID: input.parentSessionID,
                parentUserMessageID: input.parentUserMessageID,
                model: childModel,
            });
            return {
                text: parsed.text,
                childSessionID: parsed.threadId,
                model: `codex/${childModel}${childReasoningEffort ? `#${childReasoningEffort}` : ""}`,
                deniedToolCount: 0,
                tokensInput: parsed.tokensInput,
                tokensOutput: parsed.tokensOutput,
            };
        }
        catch (error) {
            if (error instanceof RlmError)
                throw error;
            throw new RlmError("CHILD_FAILED", error instanceof Error ? error.message : String(error));
        }
        finally {
            await rm(childDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}
