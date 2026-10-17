/**
 * Host-side read-only context operations. Filesystem authority comes from the
 * resolved workspace root plus a host-owned context policy. Generated code
 * cannot select or widen either boundary.
 */
import { Buffer } from "node:buffer";
import { open, opendir, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_CONTEXT_ENTRIES_SCANNED, MAX_GLOB_DIRS, MAX_GLOB_PATHS, MAX_READ_MANY_FILES, } from "./constants.js";
import { assertRlmContextPathAllowed, isRlmContextPathAllowed, mayTraverseRlmContextPath, relativeWorkspacePath, resolveActiveRlmContextPolicy, } from "./context-policy.js";
import { RlmError, toErrorInfo } from "./errors.js";
import { createSafeRegexEvaluator } from "./safe-regex.js";
import { confinePath } from "./workspace.js";
const BINARY_EXTENSIONS = new Set([
    ".7z", ".a", ".aac", ".avi", ".avif", ".bin", ".bmp", ".bz2", ".class", ".dat", ".db",
    ".dll", ".dmg", ".doc", ".docx", ".eot", ".exe", ".flac", ".gif", ".gz", ".heic", ".heif",
    ".ico", ".iso", ".jar", ".jpeg", ".jpg", ".lib", ".m4a", ".m4v", ".mkv", ".mov", ".mp3",
    ".mp4", ".mpeg", ".mpg", ".o", ".obj", ".odt", ".ods", ".odp", ".ogg", ".ogv", ".otf",
    ".pdf", ".png", ".ppt", ".pptx", ".pyc", ".pyo", ".rar", ".so", ".sqlite", ".sqlite3",
    ".svgz", ".tar", ".tif", ".tiff", ".ttf", ".war", ".wasm", ".wav", ".webm", ".webp",
    ".woff", ".woff2", ".xls", ".xlsx", ".zip",
]);
class NonTextFileError extends RlmError {
    constructor(relative, reason) {
        super("READ_FAILED", `context.read: ${reason}: ${relative}`);
        this.name = "NonTextFileError";
    }
}
function assertContextActive(state) {
    if (Date.now() >= state.deadlineAt) {
        throw new RlmError("TIMEOUT", "host context operation exceeded the rlm_exec deadline");
    }
    if (state.abort.signal.aborted) {
        throw new RlmError("RUNTIME_ERROR", "host context operation aborted with the parent rlm_exec");
    }
}
export async function executeContextOperation(state, msg) {
    assertContextActive(state);
    const policy = await resolveActiveRlmContextPolicy(process.env, state.hostConfigFallbackFile);
    assertContextActive(state);
    switch (msg.operation) {
        case "read":
            return { value: await opRead(state, policy, msg.path ?? "") };
        case "readMany":
            return { value: await opReadMany(state, policy, msg.paths ?? []) };
        case "grep":
            return { value: await opGrep(state, policy, msg.pattern ?? "") };
        case "files":
        case "glob":
            return { value: await opFiles(state, policy, msg.query ?? "") };
        default:
            throw new RlmError("PROTOCOL_ERROR", `unhandled context operation: ${String(msg.operation)}`);
    }
}
async function targetInfo(state, policy, inputPath) {
    assertContextActive(state);
    const target = await confinePath(state.workspaceRoot, inputPath);
    assertContextActive(state);
    const relative = relativeWorkspacePath(state.workspaceRoot, target);
    assertRlmContextPathAllowed(relative, policy);
    return { target, relative };
}
function readFailure(relative, reason) {
    return new RlmError("READ_FAILED", `context.read: ${reason}: ${relative}`);
}
function nonTextFailure(relative, reason) {
    return new NonTextFileError(relative, reason);
}
async function readText(state, policy, inputPath) {
    const { target, relative } = await targetInfo(state, policy, inputPath);
    let info;
    assertContextActive(state);
    try {
        info = await stat(target);
    }
    catch (error) {
        const code = error?.code;
        if (code === "ENOENT")
            throw readFailure(relative || inputPath, "file does not exist");
        throw readFailure(relative || inputPath, "cannot stat file");
    }
    assertContextActive(state);
    if (!info.isFile())
        throw readFailure(relative || inputPath, "target is not a regular file");
    if (BINARY_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
        throw nonTextFailure(relative, "binary file extension is not allowed");
    }
    if (info.size > policy.maxReadBytes) {
        throw new RlmError("BUDGET_EXCEEDED", `context.read: file is ${info.size} bytes and exceeds the approved limit of ${policy.maxReadBytes}; file content was not materialized`);
    }
    const buffer = Buffer.allocUnsafe(policy.maxReadBytes + 1);
    let handle;
    let total = 0;
    try {
        assertContextActive(state);
        handle = await open(target, "r");
        assertContextActive(state);
        while (total < buffer.length) {
            assertContextActive(state);
            const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
            assertContextActive(state);
            if (bytesRead === 0)
                break;
            total += bytesRead;
        }
    }
    catch (error) {
        if (error instanceof RlmError)
            throw error;
        throw readFailure(relative, "bounded file read failed");
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
    if (total > policy.maxReadBytes) {
        throw new RlmError("BUDGET_EXCEEDED", `context.read: file grew beyond the approved limit of ${policy.maxReadBytes} bytes during the bounded read`);
    }
    assertContextActive(state);
    const bytes = buffer.subarray(0, total);
    if (bytes.includes(0))
        throw nonTextFailure(relative, "binary/NUL content is not allowed");
    let content;
    try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        throw nonTextFailure(relative, "non-UTF-8 content is not allowed");
    }
    return { relative, content, bytes: total };
}
async function opRead(state, policy, inputPath) {
    assertContextActive(state);
    return (await readText(state, policy, inputPath)).content;
}
async function opReadMany(state, policy, paths) {
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_READ_MANY_FILES) {
        throw new RlmError("INVALID_ARGUMENT", `context.readMany: paths must be an array of 1-${MAX_READ_MANY_FILES} strings`);
    }
    for (const item of paths) {
        if (typeof item !== "string" || item.trim().length === 0) {
            throw new RlmError("INVALID_ARGUMENT", "context.readMany: every path must be a non-empty string");
        }
    }
    const items = [];
    for (const item of paths) {
        assertContextActive(state);
        try {
            items.push({ path: item, content: await opRead(state, policy, item) });
        }
        catch (error) {
            // Per-file read failures are part of readMany's result contract, but a
            // parent abort/deadline must terminate the entire host operation rather
            // than being converted into dozens of per-file errors.
            assertContextActive(state);
            items.push({ path: item, error: toErrorInfo(error) });
        }
    }
    return items;
}
async function opGrep(state, policy, pattern) {
    if (typeof pattern !== "string" || pattern.trim().length === 0) {
        throw new RlmError("INVALID_ARGUMENT", "context.grep: pattern must be a non-empty string");
    }
    assertContextActive(state);
    const evaluator = await createSafeRegexEvaluator(pattern);
    try {
        assertContextActive(state);
        const files = await opFiles(state, policy, "");
        const matches = [];
        for (const file of files) {
            assertContextActive(state);
            let item;
            try {
                item = await readText(state, policy, file);
            }
            catch (error) {
                if (error instanceof NonTextFileError)
                    continue;
                throw error;
            }
            assertContextActive(state);
            const lines = item.content.split("\n");
            const remaining = policy.maxGrepMatches - matches.length;
            const indices = await evaluator.scan(item.content, remaining);
            assertContextActive(state);
            for (const index of indices) {
                matches.push({ path: item.relative, line: index + 1, text: lines[index] });
                if (matches.length > policy.maxGrepMatches) {
                    throw new RlmError("BUDGET_EXCEEDED", `context.grep: more than ${policy.maxGrepMatches} approved matches; full search cannot be returned`);
                }
            }
        }
        return matches;
    }
    finally {
        await evaluator.close();
    }
}
async function opFiles(state, policy, query) {
    if (typeof query !== "string")
        throw new RlmError("INVALID_ARGUMENT", "context.files: query must be a string");
    assertContextActive(state);
    const needle = query.toLowerCase();
    const files = [];
    let visitedDirs = 0;
    let scannedEntries = 0;
    let depthLimitHit = false;
    let dirLimitHit = false;
    let entryLimitHit = false;
    const visit = async (relativeDir, depth) => {
        assertContextActive(state);
        if (depthLimitHit || dirLimitHit || entryLimitHit)
            return;
        if (files.length > policy.maxListEntries || files.length > MAX_GLOB_PATHS)
            return;
        if (depth > 12) {
            depthLimitHit = true;
            return;
        }
        if (visitedDirs >= MAX_GLOB_DIRS) {
            dirLimitHit = true;
            return;
        }
        if (!mayTraverseRlmContextPath(relativeDir, policy))
            return;
        const target = await confinePath(state.workspaceRoot, relativeDir || ".");
        assertContextActive(state);
        visitedDirs++;
        try {
            const directory = await opendir(target);
            assertContextActive(state);
            for await (const entry of directory) {
                assertContextActive(state);
                scannedEntries++;
                if (scannedEntries > MAX_CONTEXT_ENTRIES_SCANNED) {
                    entryLimitHit = true;
                    return;
                }
                if (entry.name === ".git" || entry.name === ".DS_Store")
                    continue;
                const relative = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
                if (entry.isDirectory()) {
                    if (mayTraverseRlmContextPath(relative, policy))
                        await visit(relative, depth + 1);
                    if (depthLimitHit || dirLimitHit || entryLimitHit)
                        return;
                    continue;
                }
                if (!isRlmContextPathAllowed(relative, policy))
                    continue;
                const name = entry.name.toLowerCase();
                if (name.includes(needle) || relative.toLowerCase().includes(needle))
                    files.push(relative);
                if (files.length > policy.maxListEntries || files.length > MAX_GLOB_PATHS)
                    return;
            }
        }
        catch (error) {
            if (error instanceof RlmError)
                throw error;
            throw new RlmError("READ_FAILED", `context.files: cannot read approved directory: ${relativeDir || "."}`);
        }
    };
    await visit("", 0);
    assertContextActive(state);
    if (files.length > policy.maxListEntries) {
        throw new RlmError("BUDGET_EXCEEDED", `context.files: more than ${policy.maxListEntries} approved paths; narrow the query`);
    }
    if (files.length > MAX_GLOB_PATHS) {
        throw new RlmError("BUDGET_EXCEEDED", `context.files: more than ${MAX_GLOB_PATHS} matching paths; narrow the query`);
    }
    if (depthLimitHit) {
        throw new RlmError("BUDGET_EXCEEDED", "context.files: directory depth exceeds the traversal limit; full result cannot be returned");
    }
    if (dirLimitHit) {
        throw new RlmError("BUDGET_EXCEEDED", `context.files: repository traversal exceeds ${MAX_GLOB_DIRS} directories; full result cannot be returned`);
    }
    if (entryLimitHit) {
        throw new RlmError("BUDGET_EXCEEDED", `context.files: repository traversal exceeds ${MAX_CONTEXT_ENTRIES_SCANNED} directory entries; full result cannot be returned`);
    }
    return files.sort((a, b) => a.localeCompare(b));
}
