import path from "node:path";
import { MAX_GLOB_PATHS, MAX_GREP_MATCHES, MAX_READ_CHARS, } from "./constants.js";
import { RlmError } from "./errors.js";
import { readRlmHostConfig } from "./host-config.js";
export const RLM_CONTEXT_POLICY_ENV = "RLM_CONTEXT_POLICY";
export const LEGACY_RLM_CONTEXT_POLICY_ENV = "OPENCODE_RLM_CONTEXT_POLICY";
const POLICY_KEYS = new Set(["allowed_paths", "max_read_bytes", "max_grep_matches", "max_list_entries"]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function policyError(source, message) {
    throw new RlmError("CONTEXT_DENIED", `invalid ${source}: ${message}`);
}
function normalizeTreePath(candidate, source = RLM_CONTEXT_POLICY_ENV) {
    if (candidate.includes("\0") || path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
        policyError(source, `allowed path must be repository-relative: ${candidate}`);
    }
    if (candidate.includes("\\"))
        policyError(source, `allowed path must use POSIX separators: ${candidate}`);
    const segments = candidate.split("/");
    if (segments.some((segment) => segment === ".."))
        policyError(source, `parent traversal is not allowed: ${candidate}`);
    return segments.filter((segment) => segment !== "" && segment !== ".").join("/");
}
function boundedInteger(value, name, fallback, hardMax, source) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
        policyError(source, `${name} must be a positive safe integer`);
    }
    return Math.min(value, hardMax);
}
function defaultPolicy() {
    return {
        allowedPaths: [],
        maxReadBytes: MAX_READ_CHARS,
        maxGrepMatches: MAX_GREP_MATCHES,
        maxListEntries: MAX_GLOB_PATHS,
    };
}
export function parseRlmContextPolicy(value, source = RLM_CONTEXT_POLICY_ENV) {
    if (value === undefined || value === null)
        return defaultPolicy();
    if (!isRecord(value))
        policyError(source, "value must be an object");
    for (const key of Object.keys(value))
        if (!POLICY_KEYS.has(key))
            policyError(source, `unexpected property: ${key}`);
    let allowedPaths = [];
    if (value.allowed_paths !== undefined) {
        if (!Array.isArray(value.allowed_paths) || value.allowed_paths.some((entry) => typeof entry !== "string")) {
            policyError(source, "allowed_paths must be an array of strings");
        }
        const normalized = value.allowed_paths.map((entry) => normalizeTreePath(entry, source));
        if (normalized.some((entry) => entry === "")) {
            policyError(source, "allowed_paths entries must name a non-empty repository-relative subtree; omit allowed_paths or use [] to allow the full context root");
        }
        allowedPaths = [...new Set(normalized)];
    }
    return {
        allowedPaths,
        maxReadBytes: boundedInteger(value.max_read_bytes, "max_read_bytes", MAX_READ_CHARS, MAX_READ_CHARS, source),
        maxGrepMatches: boundedInteger(value.max_grep_matches, "max_grep_matches", MAX_GREP_MATCHES, MAX_GREP_MATCHES, source),
        maxListEntries: boundedInteger(value.max_list_entries, "max_list_entries", MAX_GLOB_PATHS, MAX_GLOB_PATHS, source),
    };
}
/** Standalone/test seam. Environment authority can only narrow hard limits. */
export function resolveRlmContextPolicy(env = process.env) {
    const primary = env[RLM_CONTEXT_POLICY_ENV]?.trim();
    const legacy = env[LEGACY_RLM_CONTEXT_POLICY_ENV]?.trim();
    const raw = primary || legacy;
    if (!raw)
        return defaultPolicy();
    const source = primary ? RLM_CONTEXT_POLICY_ENV : LEGACY_RLM_CONTEXT_POLICY_ENV;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        policyError(source, "value must be valid JSON");
    }
    return parseRlmContextPolicy(parsed, source);
}
/**
 * A present host config is authoritative and cannot be widened or replaced by
 * ambient process environment. Environment authority is used only when no host
 * config exists.
 */
export async function resolveActiveRlmContextPolicy(env = process.env, hostConfigFallbackFile) {
    const host = await readRlmHostConfig(env, hostConfigFallbackFile);
    if (host)
        return parseRlmContextPolicy(host.context_policy, "RLM host config context_policy");
    return resolveRlmContextPolicy(env);
}
export function isRlmHiddenPath(relativePath) {
    const segments = relativePath.split("/").filter(Boolean);
    if (segments.includes(".git"))
        return true;
    return segments.some((segment) => segment.startsWith(".env") && segment !== ".env.example");
}
export function isRlmContextPathAllowed(relativePath, policy) {
    const normalized = normalizeTreePath(relativePath, "RLM context path");
    if (isRlmHiddenPath(normalized))
        return false;
    if (policy.allowedPaths.length === 0)
        return true;
    return policy.allowedPaths.some((scope) => scope === "" || normalized === scope || normalized.startsWith(`${scope}/`));
}
export function assertRlmContextPathAllowed(relativePath, policy) {
    if (!isRlmContextPathAllowed(relativePath, policy)) {
        throw new RlmError("CONTEXT_DENIED", `path is outside approved RLM context scope: ${relativePath}`);
    }
}
/** True for an allowed subtree or an ancestor required to reach one. */
export function mayTraverseRlmContextPath(relativePath, policy) {
    const normalized = normalizeTreePath(relativePath, "RLM context path");
    if (isRlmHiddenPath(normalized))
        return false;
    if (policy.allowedPaths.length === 0 || normalized === "")
        return true;
    return policy.allowedPaths.some((scope) => scope === "" || normalized === scope || normalized.startsWith(`${scope}/`) || scope.startsWith(`${normalized}/`));
}
export function relativeWorkspacePath(workspaceRoot, candidate) {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate);
    const relative = path.relative(workspaceRoot, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new RlmError("CONTEXT_DENIED", `path escapes approved RLM context root: ${candidate}`);
    }
    return relative.split(path.sep).join("/");
}
