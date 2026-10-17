/**
 * Workspace root resolution + path confinement (host side).
 */
import { realpath } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { RlmError } from "./errors.ts"
import { readRlmHostConfig } from "./host-config.ts"

export interface WorkspaceRootInfo {
  root: string
  broad: boolean
  unsafe: boolean
}

function escapesRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
}

async function canonicalize(pathValue: string, requireExisting: boolean): Promise<string> {
  try {
    return await realpath(pathValue)
  } catch {
    if (requireExisting) {
      throw new RlmError("CONTEXT_DENIED", `approved context root does not exist: ${pathValue}`)
    }
    return path.resolve(pathValue)
  }
}

/**
 * Determine the workspace root for all context operations.
 *
 * Authority order:
 *   - host-neutral `$XDG_CONFIG_HOME/rlm/host.json` authority;
 *   - RLM_CONTEXT_ROOT (or the deprecated OPENCODE_RLM_CONTEXT_ROOT alias);
 *   - the worktree supplied by the active host;
 *   - the active host session/workspace directory.
 *
 * Host config authority cannot be overridden by ambient environment. Explicit
 * host roots may intentionally differ from the host session directory but must
 * be absolute so authority never depends on the host process cwd.
 * Fallback host roots must contain the session directory. Filesystem root
 * and the user's HOME are always rejected.
 */
export async function resolveWorkspaceRoot(
  directory: string,
  worktree: string,
  hostConfigFallbackFile?: string,
): Promise<WorkspaceRootInfo> {
  const hostConfig = await readRlmHostConfig(process.env, hostConfigFallbackFile)
  const envRoot = process.env.RLM_CONTEXT_ROOT?.trim() || process.env.OPENCODE_RLM_CONTEXT_ROOT?.trim()
  const explicitRoot = hostConfig?.context_root?.trim() || envRoot
  if (explicitRoot && !path.isAbsolute(explicitRoot)) {
    throw new RlmError("CONTEXT_DENIED", "rlm_exec: explicit context root must be an absolute path")
  }
  const hasWorktree = Boolean(worktree && worktree !== "/" && worktree !== "")
  const preferred = explicitRoot || (hasWorktree ? worktree : directory)
  const canonical = await canonicalize(preferred, Boolean(explicitRoot))
  const filesystemRoot = path.parse(canonical).root
  const homeRoot = await canonicalize(os.homedir(), false)

  if (canonical === filesystemRoot) {
    throw new RlmError("CONTEXT_DENIED", "rlm_exec: filesystem root cannot be used as a context root")
  }
  if (canonical === homeRoot) {
    throw new RlmError("CONTEXT_DENIED", "rlm_exec: user HOME cannot be used as a context root; use an explicit project workspace")
  }

  if (!explicitRoot) {
    const canonicalDirectory = await canonicalize(directory, false)
    if (escapesRoot(canonical, canonicalDirectory)) {
      const source = hasWorktree ? "host worktree" : "session directory"
      throw new RlmError("CONTEXT_DENIED", `rlm_exec: session directory is outside ${source}: ${directory}`)
    }
  }

  return { root: canonical, broad: false, unsafe: false }
}

function assertCanonicalInsideRoot(rootCanonical: string, canonical: string, inputPath: string): void {
  if (escapesRoot(rootCanonical, canonical)) {
    throw new RlmError("CONTEXT_DENIED", `path escapes project root via symlink: ${inputPath}`)
  }
}

/**
 * Symlink-safe confinement. First a lexical check rejects absolute/`..`
 * escapes. Existing targets are checked by canonical path. For a missing
 * target, the nearest existing ancestor is canonicalized before any SDK file
 * operation so a symlinked parent cannot redirect listing/existence checks
 * outside the approved root.
 *
 * Returns the canonical path for an existing target, otherwise the lexical
 * candidate after its nearest existing ancestor has been proven confined.
 */
export async function confinePath(root: string, inputPath: string): Promise<string> {
  const rootResolved = path.resolve(root)
  const candidate = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(rootResolved, inputPath)
  if (escapesRoot(rootResolved, candidate)) {
    throw new RlmError("CONTEXT_DENIED", `path escapes project root: ${inputPath}`)
  }

  const rootCanonical = await realpath(rootResolved).catch(() => null)
  try {
    const canonical = await realpath(candidate)
    if (rootCanonical) assertCanonicalInsideRoot(rootCanonical, canonical, inputPath)
    return canonical
  } catch (error) {
    if (error instanceof RlmError) throw error
  }

  // A non-existent approved root cannot contain an existing symlink ancestor;
  // retain lexical behavior for virtual/test clients that do not touch the host
  // filesystem. Production workspace resolution supplies an existing root.
  if (!rootCanonical) return candidate

  let ancestor = path.dirname(candidate)
  for (;;) {
    if (escapesRoot(rootResolved, ancestor)) {
      throw new RlmError("CONTEXT_DENIED", `path escapes project root: ${inputPath}`)
    }
    try {
      const ancestorCanonical = await realpath(ancestor)
      assertCanonicalInsideRoot(rootCanonical, ancestorCanonical, inputPath)
      return candidate
    } catch (error) {
      if (error instanceof RlmError) throw error
    }
    if (ancestor === rootResolved) return candidate
    const parent = path.dirname(ancestor)
    if (parent === ancestor) return candidate
    ancestor = parent
  }
}
