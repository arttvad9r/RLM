#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MAX_SUBCALLS_TOTAL } from "../../plugin/rlm-lib/constants.js";
import { RlmError, toErrorInfo } from "../../plugin/rlm-lib/errors.js";
import { executeRlmExec } from "../../plugin/rlm-lib/sandbox.js";
import { executeRlmMap } from "../../plugin/rlm-lib/structured-map.js";
import { RLM_EXEC_DESCRIPTION, RLM_MAP_DESCRIPTION } from "../../plugin/rlm-lib/tool-description.js";
import { CodexRlmHost, parseCodexInvocationContext } from "./codex-host.js";
const server = new McpServer({ name: "rlm", version: "0.1.0" }, { maxToolInputElements: 64 });
const log = async (level, message, extra = {}) => {
    // MCP owns stdout. Diagnostics must stay on stderr.
    console.error(`[rlm:${level}] ${message}`, extra);
};
function errorResponse(error) {
    const info = error instanceof RlmError ? { code: error.code, message: error.message } : toErrorInfo(error);
    return {
        content: [{ type: "text", text: `${info.code}: ${info.message}` }],
        isError: true,
    };
}
server.registerTool("rlm_exec", {
    title: "RLM Execute",
    description: RLM_EXEC_DESCRIPTION,
    inputSchema: {
        code: z.string().min(1).describe("JavaScript code to run in the RLM sandbox. Use return, await llm(...), llm.batch([...]), context.*, or turn-scoped memory.*."),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
    },
}, async ({ code }, extra) => {
    try {
        const context = parseCodexInvocationContext(extra._meta);
        const host = new CodexRlmHost(context);
        const outcome = await executeRlmExec(host, {
            code,
            parentSessionID: context.threadId,
            directory: context.workspaceRoot,
            worktree: context.workspaceRoot,
            messageID: context.turnId,
            abort: extra.signal,
            log,
        });
        return {
            content: [{ type: "text", text: outcome.output }],
            _meta: { rlm: outcome.metadata },
        };
    }
    catch (error) {
        return errorResponse(error);
    }
});
server.registerTool("rlm_map", {
    title: "RLM Structured Map",
    description: RLM_MAP_DESCRIPTION,
    inputSchema: {
        query: z.string().min(1).describe("Repository file query passed to the bounded context.files API."),
        instruction: z.string().min(1).describe("Semantic instruction sent to each partition child, including its exact output contract."),
        fanout: z.number().int().min(1).max(MAX_SUBCALLS_TOTAL).optional().describe("Semantic partitions; defaults to 4. Runtime concurrency remains capped at 4."),
        output: z.enum(["text", "path_list", "candidate_bundle"]).optional().describe("Deterministic merge mode; defaults to text."),
        partition: z.enum(["round_robin", "balanced_chars"]).optional().describe("Deterministic partition strategy; defaults to round_robin."),
        failureMode: z.enum(["strict", "settled"]).optional().describe("Child failure semantics; defaults to strict."),
    },
    annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
    },
}, async ({ query, instruction, fanout, output, partition, failureMode }, extra) => {
    try {
        const context = parseCodexInvocationContext(extra._meta);
        const host = new CodexRlmHost(context);
        const outcome = await executeRlmMap(host, {
            input: { query, instruction, fanout, output, partition, failureMode },
            parentSessionID: context.threadId,
            directory: context.workspaceRoot,
            worktree: context.workspaceRoot,
            messageID: context.turnId,
            abort: extra.signal,
            log,
        });
        return {
            content: [{ type: "text", text: outcome.output }],
            _meta: { rlm: outcome.metadata },
        };
    }
    catch (error) {
        return errorResponse(error);
    }
});
await server.connect(new StdioServerTransport());
