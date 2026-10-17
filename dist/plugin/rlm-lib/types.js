/**
 * RLM protocol v1 types, stable error codes, and the single per-run state.
 * Shared by host and sandbox runner (dependency-free).
 */
import { PROTOCOL_VERSION } from "./constants.js";
function genRunId() {
    const c = globalThis.crypto;
    const uuid = c?.randomUUID?.();
    const raw = uuid ?? `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    return `rlm_${raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;
}
export class RlmRunState {
    runId;
    protocolVersion = PROTOCOL_VERSION;
    workspaceRoot;
    broadWorkspaceRoot;
    hostConfigFallbackFile;
    startedAt;
    deadlineAt;
    abort = new AbortController();
    activeChildSessions = new Map();
    childSessionIDs = [];
    childModels = [];
    childInvocations = [];
    /** Internal host cache: canonical parent dir -> listing promise (names). */
    dirListings = new Map();
    childCallCount = 0;
    childSuccessCount = 0;
    childFailureCount = 0;
    contextCallCount = 0;
    contextCharsSent = 0;
    memoryCallCount = 0;
    // child token/cost aggregation (from prompt info when available)
    childCostSum = 0;
    childTokensInputSum = 0;
    childTokensOutputSum = 0;
    childTokensCacheReadSum = 0;
    childTokensCacheWriteSum = 0;
    timedOut = false;
    exitCode = null;
    constructor(opts) {
        this.runId = genRunId();
        this.workspaceRoot = opts.workspaceRoot;
        this.broadWorkspaceRoot = opts.broadWorkspaceRoot;
        this.hostConfigFallbackFile = opts.hostConfigFallbackFile;
        this.startedAt = Date.now();
        this.deadlineAt = this.startedAt + opts.timeoutMs;
    }
    /** Abort children and the sandbox; safe to call multiple times. */
    cleanup() {
        this.abort.abort();
        for (const child of this.activeChildSessions.values()) {
            try {
                child.abort();
            }
            catch {
                // ignore
            }
        }
        this.activeChildSessions.clear();
    }
}
