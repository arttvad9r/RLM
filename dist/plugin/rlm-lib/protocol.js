/**
 * Protocol v1 framing + strict message validation. Shared by host and sandbox
 * runner. Every violation surfaces as RlmError with code PROTOCOL_ERROR so
 * callers get a stable error code instead of a silent partial result.
 */
import { PROTOCOL_VERSION } from "./constants.js";
import { RlmError } from "./errors.js";
const HOST_TYPES = new Set(["code", "llm_result", "context_result", "memory_result"]);
const SANDBOX_TYPES = new Set(["llm", "context", "memory", "result", "error"]);
const CONTEXT_OPS = new Set(["read", "readMany", "grep", "files", "glob"]);
const MEMORY_OPS = new Set(["get", "set", "delete", "keys"]);
const ERROR_CODES = new Set([
    "BUDGET_EXCEEDED",
    "TIMEOUT",
    "CONTEXT_DENIED",
    "CHILD_FAILED",
    "PROTOCOL_ERROR",
    "RUNTIME_ERROR",
    "READ_FAILED",
    "INVALID_ARGUMENT",
]);
export const SANDBOX_FRAME_PREFIX = "RLM1";
const PROTOCOL_CHANNEL_RE = /^[a-f0-9]{48}$/;
function isRecord(x) {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}
function protoError(message) {
    return new RlmError("PROTOCOL_ERROR", message);
}
export function validateProtocolChannel(channel) {
    if (typeof channel !== "string" || !PROTOCOL_CHANNEL_RE.test(channel)) {
        throw protoError("invalid sandbox protocol channel");
    }
    return channel;
}
/** Parse a host->sandbox message with strict validation. */
export function parseHostMessage(line) {
    let raw;
    try {
        raw = JSON.parse(line);
    }
    catch {
        throw protoError(`malformed JSON from host: ${line.slice(0, 200)}`);
    }
    if (!isRecord(raw))
        throw protoError("host message is not an object");
    if (raw.v !== PROTOCOL_VERSION)
        throw protoError(`unsupported protocol version: ${String(raw.v)}`);
    const type = raw.type;
    if (typeof type !== "string" || !HOST_TYPES.has(type)) {
        throw protoError(`unknown host message type: ${String(type)}`);
    }
    const m = raw;
    if (type === "code") {
        if (typeof m.code !== "string")
            throw protoError("code message missing string code");
        return { v: PROTOCOL_VERSION, type: "code", code: m.code };
    }
    if (type === "llm_result") {
        if (typeof m.id !== "string" || typeof m.ok !== "boolean")
            throw protoError("llm_result message missing id/ok");
        if (m.ok) {
            if (typeof m.text !== "string")
                throw protoError("successful llm_result missing string text");
            if (m.error !== undefined)
                throw protoError("successful llm_result must not include error");
            return {
                v: PROTOCOL_VERSION,
                type: "llm_result",
                id: m.id,
                ok: true,
                text: m.text,
            };
        }
        const error = validateErrorInfo(m.error);
        if (!error)
            throw protoError("failed llm_result missing error envelope");
        if (m.text !== undefined)
            throw protoError("failed llm_result must not include text");
        return {
            v: PROTOCOL_VERSION,
            type: "llm_result",
            id: m.id,
            ok: false,
            error,
        };
    }
    const resultKind = type === "memory_result" ? "memory_result" : "context_result";
    if (typeof m.id !== "string" || typeof m.ok !== "boolean")
        throw protoError(`${resultKind} message missing id/ok`);
    if (m.ok) {
        if (!Object.prototype.hasOwnProperty.call(m, "value"))
            throw protoError(`successful ${resultKind} missing value`);
        if (m.error !== undefined)
            throw protoError(`successful ${resultKind} must not include error`);
        return {
            v: PROTOCOL_VERSION,
            type: resultKind,
            id: m.id,
            ok: true,
            value: m.value,
        };
    }
    const error = validateErrorInfo(m.error);
    if (!error)
        throw protoError(`failed ${resultKind} missing error envelope`);
    if (Object.prototype.hasOwnProperty.call(m, "value"))
        throw protoError(`failed ${resultKind} must not include value`);
    return {
        v: PROTOCOL_VERSION,
        type: resultKind,
        id: m.id,
        ok: false,
        error,
    };
}
/** Parse a sandbox->host message with strict validation. */
export function parseSandboxMessage(line) {
    let raw;
    try {
        raw = JSON.parse(line);
    }
    catch {
        throw protoError(`malformed JSON from sandbox: ${line.slice(0, 200)}`);
    }
    if (!isRecord(raw))
        throw protoError("sandbox message is not an object");
    if (raw.v !== PROTOCOL_VERSION)
        throw protoError(`unsupported protocol version: ${String(raw.v)}`);
    const type = raw.type;
    if (typeof type !== "string" || !SANDBOX_TYPES.has(type)) {
        throw protoError(`unknown sandbox message type: ${String(type)}`);
    }
    const m = raw;
    if (type === "llm") {
        if (typeof m.id !== "string" || typeof m.prompt !== "string")
            throw protoError("llm message missing id/prompt");
        return { v: PROTOCOL_VERSION, type: "llm", id: m.id, prompt: m.prompt };
    }
    if (type === "context") {
        if (typeof m.id !== "string")
            throw protoError("context message missing id");
        const operation = m.operation;
        if (typeof operation !== "string" || !CONTEXT_OPS.has(operation)) {
            throw protoError(`unknown context operation: ${String(operation)}`);
        }
        const msg = {
            v: PROTOCOL_VERSION,
            type: "context",
            id: m.id,
            operation: operation,
        };
        if (m.path !== undefined) {
            if (typeof m.path !== "string")
                throw protoError("context path must be a string");
            msg.path = m.path;
        }
        if (m.paths !== undefined) {
            if (!Array.isArray(m.paths) || m.paths.some((p) => typeof p !== "string")) {
                throw protoError("context paths must be an array of strings");
            }
            msg.paths = m.paths;
        }
        if (m.pattern !== undefined) {
            if (typeof m.pattern !== "string")
                throw protoError("context pattern must be a string");
            msg.pattern = m.pattern;
        }
        if (m.query !== undefined) {
            if (typeof m.query !== "string")
                throw protoError("context query must be a string");
            msg.query = m.query;
        }
        return msg;
    }
    if (type === "memory") {
        if (typeof m.id !== "string")
            throw protoError("memory message missing id");
        const operation = m.operation;
        if (typeof operation !== "string" || !MEMORY_OPS.has(operation)) {
            throw protoError(`unknown memory operation: ${String(operation)}`);
        }
        const msg = {
            v: PROTOCOL_VERSION,
            type: "memory",
            id: m.id,
            operation: operation,
        };
        if (operation === "get" || operation === "set" || operation === "delete") {
            if (typeof m.key !== "string")
                throw protoError(`memory ${operation} requires string key`);
            msg.key = m.key;
        }
        else if (m.key !== undefined) {
            throw protoError("memory keys must not include key");
        }
        if (operation === "set") {
            if (!Object.prototype.hasOwnProperty.call(m, "value"))
                throw protoError("memory set requires value");
            msg.value = m.value;
        }
        else if (Object.prototype.hasOwnProperty.call(m, "value")) {
            throw protoError(`memory ${operation} must not include value`);
        }
        return msg;
    }
    if (type === "result") {
        if (!Object.prototype.hasOwnProperty.call(m, "value"))
            throw protoError("result message missing value");
        return { v: PROTOCOL_VERSION, type: "result", value: m.value };
    }
    const info = validateErrorInfo(m.error);
    if (!info)
        throw protoError("error message missing error envelope");
    return { v: PROTOCOL_VERSION, type: "error", error: info };
}
/** Encode a message to one JSONL line. */
export function encodeMessage(msg) {
    return JSON.stringify(msg);
}
/**
 * Sandbox->host frames are authenticated with a per-exec random channel.
 * Unauthenticated stdout is intentionally not protocol data: generated code
 * may be able to write to process stdout even when Deno I/O permissions are
 * otherwise denied.
 */
export function encodeSandboxFrame(channel, msg) {
    const trustedChannel = validateProtocolChannel(channel);
    return `${SANDBOX_FRAME_PREFIX}:${trustedChannel}:${encodeMessage(msg)}`;
}
/** Returns null for stdout that is not an authenticated sandbox frame. */
export function parseSandboxFrame(line, expectedChannel) {
    const trustedChannel = validateProtocolChannel(expectedChannel);
    const prefix = `${SANDBOX_FRAME_PREFIX}:${trustedChannel}:`;
    if (!line.startsWith(prefix))
        return null;
    return parseSandboxMessage(line.slice(prefix.length));
}
export function validateErrorInfo(x) {
    if (x === undefined || x === null)
        return undefined;
    if (!isRecord(x) || typeof x.code !== "string" || typeof x.message !== "string") {
        throw protoError("invalid error envelope");
    }
    if (!ERROR_CODES.has(x.code)) {
        throw protoError(`unknown error code: ${x.code}`);
    }
    return { code: x.code, message: x.message };
}
