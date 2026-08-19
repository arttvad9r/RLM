import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { RlmError } from "./errors.ts"

export const RLM_HOST_CONFIG_FILENAME = ".rlm-host.json"

export interface RlmHostConfig {
  version: 1
  context_root: string
  context_policy?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Read host-materialized RLM authority from the OpenCode agents config
 * directory. Missing config is valid for standalone mode because workspace
 * resolution can still use an explicit environment root or a safe OpenCode
 * worktree/directory fallback. A present but malformed config fails closed.
 */
export async function readRlmHostConfig(env: NodeJS.ProcessEnv = process.env): Promise<RlmHostConfig | undefined> {
  const configHome = env.XDG_CONFIG_HOME?.trim()
  if (!configHome) return undefined
  const file = join(configHome, "opencode", "agents", RLM_HOST_CONFIG_FILENAME)
  let text: string
  try {
    text = await readFile(file, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return undefined
    throw new RlmError("CONTEXT_DENIED", `failed to read RLM host config: ${String(error)}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new RlmError("CONTEXT_DENIED", "RLM host config is malformed JSON")
  }
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.context_root !== "string" || raw.context_root.trim().length === 0) {
    throw new RlmError("CONTEXT_DENIED", "RLM host config has an invalid authority envelope")
  }
  if (!isAbsolute(raw.context_root)) {
    throw new RlmError("CONTEXT_DENIED", "RLM host config context_root must be an absolute path")
  }
  const keys = Object.keys(raw)
  if (keys.some((key) => !["version", "context_root", "context_policy"].includes(key))) {
    throw new RlmError("CONTEXT_DENIED", "RLM host config contains unexpected properties")
  }
  if (raw.context_policy !== undefined && !isRecord(raw.context_policy)) {
    throw new RlmError("CONTEXT_DENIED", "RLM host config context_policy must be an object")
  }
  return {
    version: 1,
    context_root: raw.context_root,
    context_policy: raw.context_policy as Record<string, unknown> | undefined,
  }
}
