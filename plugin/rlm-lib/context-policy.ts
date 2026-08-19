import path from "node:path"
import {
  MAX_GLOB_PATHS,
  MAX_GREP_MATCHES,
  MAX_READ_CHARS,
} from "./constants.ts"
import { RlmError } from "./errors.ts"
import { readRlmHostConfig } from "./host-config.ts"

export const RLM_CONTEXT_POLICY_ENV = "OPENCODE_RLM_CONTEXT_POLICY"

export interface RlmContextPolicy {
  allowedPaths: string[]
  maxReadBytes: number
  maxGrepMatches: number
  maxListEntries: number
}

const POLICY_KEYS = new Set(["allowed_paths", "max_read_bytes", "max_grep_matches", "max_list_entries"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function policyError(source: string, message: string): never {
  throw new RlmError("CONTEXT_DENIED", `invalid ${source}: ${message}`)
}

function normalizeTreePath(candidate: string, source = RLM_CONTEXT_POLICY_ENV): string {
  if (candidate.includes("\0") || path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
    policyError(source, `allowed path must be repository-relative: ${candidate}`)
  }
  if (candidate.includes("\\")) policyError(source, `allowed path must use POSIX separators: ${candidate}`)
  const segments = candidate.split("/")
  if (segments.some((segment) => segment === "..")) policyError(source, `parent traversal is not allowed: ${candidate}`)
  return segments.filter((segment) => segment !== "" && segment !== ".").join("/")
}

function boundedInteger(value: unknown, name: string, fallback: number, hardMax: number, source: string): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    policyError(source, `${name} must be a positive safe integer`)
  }
  return Math.min(value, hardMax)
}

function defaultPolicy(): RlmContextPolicy {
  return {
    allowedPaths: [],
    maxReadBytes: MAX_READ_CHARS,
    maxGrepMatches: MAX_GREP_MATCHES,
    maxListEntries: MAX_GLOB_PATHS,
  }
}

export function parseRlmContextPolicy(value: unknown, source = RLM_CONTEXT_POLICY_ENV): RlmContextPolicy {
  if (value === undefined || value === null) return defaultPolicy()
  if (!isRecord(value)) policyError(source, "value must be an object")
  for (const key of Object.keys(value)) if (!POLICY_KEYS.has(key)) policyError(source, `unexpected property: ${key}`)

  let allowedPaths: string[] = []
  if (value.allowed_paths !== undefined) {
    if (!Array.isArray(value.allowed_paths) || value.allowed_paths.some((entry) => typeof entry !== "string")) {
      policyError(source, "allowed_paths must be an array of strings")
    }
    allowedPaths = [...new Set((value.allowed_paths as string[]).map((entry) => normalizeTreePath(entry, source)))]
  }

  return {
    allowedPaths,
    maxReadBytes: boundedInteger(value.max_read_bytes, "max_read_bytes", MAX_READ_CHARS, MAX_READ_CHARS, source),
    maxGrepMatches: boundedInteger(value.max_grep_matches, "max_grep_matches", MAX_GREP_MATCHES, MAX_GREP_MATCHES, source),
    maxListEntries: boundedInteger(value.max_list_entries, "max_list_entries", MAX_GLOB_PATHS, MAX_GLOB_PATHS, source),
  }
}

/** Standalone/test seam. Environment authority can only narrow hard limits. */
export function resolveRlmContextPolicy(env: NodeJS.ProcessEnv = process.env): RlmContextPolicy {
  const raw = env[RLM_CONTEXT_POLICY_ENV]?.trim()
  if (!raw) return defaultPolicy()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    policyError(RLM_CONTEXT_POLICY_ENV, "value must be valid JSON")
  }
  return parseRlmContextPolicy(parsed, RLM_CONTEXT_POLICY_ENV)
}

/**
 * A present host config is authoritative and cannot be widened or replaced by
 * ambient process environment. Environment authority is used only when no host
 * config exists.
 */
export async function resolveActiveRlmContextPolicy(env: NodeJS.ProcessEnv = process.env): Promise<RlmContextPolicy> {
  const host = await readRlmHostConfig(env)
  if (host) return parseRlmContextPolicy(host.context_policy, "RLM host config context_policy")
  return resolveRlmContextPolicy(env)
}

export function isRlmHiddenPath(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean)
  if (segments.includes(".git")) return true
  return segments.some(
    (segment) => segment === ".env" || (segment.startsWith(".env.") && segment !== ".env.example"),
  )
}

export function isRlmContextPathAllowed(relativePath: string, policy: RlmContextPolicy): boolean {
  const normalized = normalizeTreePath(relativePath, "RLM context path")
  if (isRlmHiddenPath(normalized)) return false
  if (policy.allowedPaths.length === 0) return true
  return policy.allowedPaths.some((scope) => scope === "" || normalized === scope || normalized.startsWith(`${scope}/`))
}

export function assertRlmContextPathAllowed(relativePath: string, policy: RlmContextPolicy): void {
  if (!isRlmContextPathAllowed(relativePath, policy)) {
    throw new RlmError("CONTEXT_DENIED", `path is outside approved RLM context scope: ${relativePath}`)
  }
}

/** True for an allowed subtree or an ancestor required to reach one. */
export function mayTraverseRlmContextPath(relativePath: string, policy: RlmContextPolicy): boolean {
  const normalized = normalizeTreePath(relativePath, "RLM context path")
  if (isRlmHiddenPath(normalized)) return false
  if (policy.allowedPaths.length === 0 || normalized === "") return true
  return policy.allowedPaths.some(
    (scope) => scope === "" || normalized === scope || normalized.startsWith(`${scope}/`) || scope.startsWith(`${normalized}/`),
  )
}

export function relativeWorkspacePath(workspaceRoot: string, candidate: string): string {
  const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(workspaceRoot, candidate)
  const relative = path.relative(workspaceRoot, absolute)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new RlmError("CONTEXT_DENIED", `path escapes approved RLM context root: ${candidate}`)
  }
  return relative.split(path.sep).join("/")
}
