import { Worker } from "node:worker_threads";
import { RlmError } from "./errors.js";
// Worker startup is scheduler-dependent on hosted/runtime environments and is
// bounded separately from model-supplied regex matching. The match timeout is
// the preemption boundary for pathological backtracking.
const REGEX_INIT_TIMEOUT_MS = 2_000;
const REGEX_EVAL_TIMEOUT_MS = 250;
const WORKER_SOURCE = String.raw `
const { parentPort, workerData } = require("node:worker_threads")
let regex
try {
  regex = new RegExp(workerData.pattern)
} catch {
  parentPort.postMessage({ type: "invalid" })
}
if (regex) {
  parentPort.postMessage({ type: "ready" })
  parentPort.on("message", ({ content, maxMatches }) => {
    const lines = String(content).split("\n")
    const indices = []
    for (let index = 0; index < lines.length; index++) {
      regex.lastIndex = 0
      if (!regex.test(lines[index])) continue
      indices.push(index)
      if (indices.length > maxMatches) break
    }
    parentPort.postMessage({ type: "result", indices })
  })
}
`;
function timeoutError(stage) {
    const timeoutMs = stage === "initialization" ? REGEX_INIT_TIMEOUT_MS : REGEX_EVAL_TIMEOUT_MS;
    return new RlmError("TIMEOUT", `context.grep: regular expression ${stage} exceeded ${timeoutMs}ms`);
}
export async function createSafeRegexEvaluator(pattern) {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { pattern } });
    let closed = false;
    let readySettled = false;
    let pending;
    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });
    const fail = (error) => {
        if (!readySettled) {
            readySettled = true;
            readyReject(error);
        }
        if (pending) {
            clearTimeout(pending.timer);
            const current = pending;
            pending = undefined;
            current.reject(error);
        }
    };
    worker.on("message", (message) => {
        if (message?.type === "ready" && !readySettled) {
            readySettled = true;
            readyResolve();
            return;
        }
        if (message?.type === "invalid" && !readySettled) {
            readySettled = true;
            readyReject(new RlmError("INVALID_ARGUMENT", `context.grep: invalid regular expression: ${pattern}`));
            return;
        }
        if (message?.type === "result" && pending) {
            clearTimeout(pending.timer);
            const current = pending;
            pending = undefined;
            current.resolve(message.indices);
        }
    });
    worker.on("error", (error) => fail(new RlmError("RUNTIME_ERROR", `context.grep regex worker failed: ${error.message}`)));
    worker.on("exit", (code) => {
        if (!closed && code !== 0)
            fail(new RlmError("RUNTIME_ERROR", `context.grep regex worker exited with code ${code}`));
    });
    const initTimer = setTimeout(() => {
        if (readySettled)
            return;
        readySettled = true;
        closed = true;
        readyReject(timeoutError("initialization"));
        void worker.terminate();
    }, REGEX_INIT_TIMEOUT_MS);
    try {
        await ready;
    }
    catch (error) {
        closed = true;
        await worker.terminate().catch(() => undefined);
        throw error;
    }
    finally {
        clearTimeout(initTimer);
    }
    return {
        scan(content, maxMatches) {
            if (closed)
                return Promise.reject(new RlmError("RUNTIME_ERROR", "context.grep regex worker is closed"));
            if (pending)
                return Promise.reject(new RlmError("RUNTIME_ERROR", "context.grep regex worker received concurrent scans"));
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    if (!pending)
                        return;
                    pending = undefined;
                    closed = true;
                    reject(timeoutError("evaluation"));
                    void worker.terminate();
                }, REGEX_EVAL_TIMEOUT_MS);
                pending = { resolve, reject, timer };
                worker.postMessage({ content, maxMatches });
            });
        },
        async close() {
            if (closed)
                return;
            closed = true;
            if (pending) {
                clearTimeout(pending.timer);
                const current = pending;
                pending = undefined;
                current.reject(new RlmError("RUNTIME_ERROR", "context.grep regex worker closed during scan"));
            }
            await worker.terminate();
        },
    };
}
