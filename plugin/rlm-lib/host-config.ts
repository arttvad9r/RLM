import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { homedir } from "node:os"
import { RlmError } from "./errors.ts"

export const RLM_HOST_CONFIG_FILENAME = "host.json"

export type RlmChildModelPolicy =
  | { strategy: "inherit" }
  | { strategy: "fixed"; provider?: string; model: string; variant?: string }

export interface RlmHostConfig {
  version: 1
  context_root?: string
  context_policy?: Record<string, unknown>
  child_model?: RlmChildModelPolicy
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalNonEmptyString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RlmError("CONTEXT_DENIED", `RLM host config ${name} must be a non-empty string`)
  }
  return value.trim()
}

function parseChildModel(value: unknown): RlmChildModelPolicy | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new RlmError("CONTEXT_DENIED", "RLM host config child_model must be an object")
  const strategy = value.strategy
  if (strategy !== "inherit" && strategy !== "fixed") {
    throw new RlmError("CONTEXT_DENIED", "RLM host config child_model.strategy must be inherit or fixed")
  }
  const allowed = strategy === "inherit" ? ["strategy"] : ["strategy", "provider", "model", "variant"]
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new RlmError("CONTEXT_DENIED", "RLM host config child_model contains unexpected properties")
  }
  if (strategy === "inherit") return { strategy }
  const model = optionalNonEmptyString(value.model, "child_model.model")
  if (!model) throw new RlmError("CONTEXT_DENIED", "RLM host config fixed child_model requires model")
  const provider = optionalNonEmptyString(value.provider, "child_model.provider")
  const variant = optionalNonEmptyString(value.variant, "child_model.variant")
  return { strategy, ...(provider ? { provider } : {}), model, ...(variant ? { variant } : {}) }
}

/** Read host-neutral RLM configuration from `$XDG_CONFIG_HOME/rlm/host.json`. */
export async function readRlmHostConfig(
  env: NodeJS.ProcessEnv = process.env,
  fallbackFile?: string,
): Promise<RlmHostConfig | undefined> {
  const configuredHome = env.XDG_CONFIG_HOME?.trim()
  if (configuredHome && !isAbsolute(configuredHome)) {
    throw new RlmError("CONTEXT_DENIED", "XDG_CONFIG_HOME must be an absolute path for RLM host authority")
  }
  if (fallbackFile && !isAbsolute(fallbackFile)) {
    throw new RlmError("CONTEXT_DENIED", "RLM host config fallback must be an absolute path")
  }
  const home = env.HOME?.trim() || homedir()
  if (!configuredHome && !isAbsolute(home)) {
    throw new RlmError("CONTEXT_DENIED", "HOME must be an absolute path for default RLM host config discovery")
  }
  const configHome = configuredHome || join(home, ".config")
  const candidates = [
    join(configHome, "rlm", RLM_HOST_CONFIG_FILENAME),
    ...(fallbackFile ? [fallbackFile] : []),
  ].filter((file, index, files) => files.indexOf(file) === index)

  for (const file of candidates) {
    let text: string
    try { text = await readFile(file, "utf8") } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT" || code === "ENOTDIR") continue
      throw new RlmError("CONTEXT_DENIED", `failed to read RLM host config: ${String(error)}`)
    }
    let raw: unknown
    try { raw = JSON.parse(text) } catch { throw new RlmError("CONTEXT_DENIED", "RLM host config is malformed JSON") }
    if (!isRecord(raw) || raw.version !== 1) {
      throw new RlmError("CONTEXT_DENIED", "RLM host config has an invalid authority envelope")
    }
    const keys = Object.keys(raw)
    if (keys.some((key) => !["version", "context_root", "context_policy", "child_model"].includes(key))) {
      throw new RlmError("CONTEXT_DENIED", "RLM host config contains unexpected properties")
    }
    const contextRoot = optionalNonEmptyString(raw.context_root, "context_root")
    if (contextRoot && !isAbsolute(contextRoot)) {
      throw new RlmError("CONTEXT_DENIED", "RLM host config context_root must be an absolute path")
    }
    if (raw.context_policy !== undefined && !isRecord(raw.context_policy)) {
      throw new RlmError("CONTEXT_DENIED", "RLM host config context_policy must be an object")
    }
    return {
      version: 1,
      ...(contextRoot ? { context_root: contextRoot } : {}),
      context_policy: raw.context_policy as Record<string, unknown> | undefined,
      child_model: parseChildModel(raw.child_model),
    }
  }
  return undefined
}

export async function resolveRlmChildModelPolicy(
  env: NodeJS.ProcessEnv = process.env,
  fallbackFile?: string,
): Promise<RlmChildModelPolicy> {
  return (await readRlmHostConfig(env, fallbackFile))?.child_model ?? { strategy: "inherit" }
}
