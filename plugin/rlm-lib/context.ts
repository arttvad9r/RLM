/**
 * Host-side read-only context operations. Filesystem authority comes from the
 * resolved workspace root plus a host-owned context policy. Generated code
 * cannot select or widen either boundary.
 */
import { Buffer } from "node:buffer"
import { open, opendir, stat } from "node:fs/promises"
import path from "node:path"
import {
  MAX_CONTEXT_ENTRIES_SCANNED,
  MAX_GLOB_DIRS,
  MAX_GLOB_PATHS,
  MAX_READ_MANY_FILES,
} from "./constants.ts"
import {
  assertRlmContextPathAllowed,
  isRlmContextPathAllowed,
  mayTraverseRlmContextPath,
  relativeWorkspacePath,
  resolveActiveRlmContextPolicy,
  type RlmContextPolicy,
} from "./context-policy.ts"
import { RlmError, toErrorInfo } from "./errors.ts"
import { createSafeRegexEvaluator } from "./safe-regex.ts"
import type { ContextRequestMessage, GrepMatch, ReadManyItem, RlmRunState } from "./types.ts"
import { confinePath } from "./workspace.ts"

type Client = { file: unknown }

const BINARY_EXTENSIONS = new Set([
  ".7z", ".a", ".bin", ".bz2", ".class", ".dat", ".dll", ".dmg", ".doc", ".docx",
  ".exe", ".gz", ".iso", ".jar", ".lib", ".o", ".obj", ".odt", ".ods", ".odp",
  ".pdf", ".ppt", ".pptx", ".pyc", ".pyo", ".rar", ".so", ".tar", ".wasm", ".war",
  ".xls", ".xlsx", ".zip",
])

export async function executeContextOperation(
  _client: Client,
  state: RlmRunState,
  _directory: string,
  msg: ContextRequestMessage,
): Promise<{ value: unknown }> {
  const policy = await resolveActiveRlmContextPolicy()
  switch (msg.operation) {
    case "read":
      return { value: await opRead(state, policy, msg.path ?? "") }
    case "readMany":
      return { value: await opReadMany(state, policy, msg.paths ?? []) }
    case "grep":
      return { value: await opGrep(state, policy, msg.pattern ?? "") }
    case "files":
    case "glob":
      return { value: await opFiles(state, policy, msg.query ?? "") }
    default:
      throw new RlmError("PROTOCOL_ERROR", `unhandled context operation: ${String(msg.operation)}`)
  }
}

async function targetInfo(
  state: RlmRunState,
  policy: RlmContextPolicy,
  inputPath: string,
): Promise<{ target: string; relative: string }> {
  const target = await confinePath(state.workspaceRoot, inputPath)
  const relative = relativeWorkspacePath(state.workspaceRoot, target)
  assertRlmContextPathAllowed(relative, policy)
  return { target, relative }
}

function readFailure(relative: string, reason: string): RlmError {
  return new RlmError("READ_FAILED", `context.read: ${reason}: ${relative}`)
}

async function readText(
  state: RlmRunState,
  policy: RlmContextPolicy,
  inputPath: string,
): Promise<{ relative: string; content: string; bytes: number }> {
  const { target, relative } = await targetInfo(state, policy, inputPath)

  let info
  try {
    info = await stat(target)
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    if (code === "ENOENT") throw readFailure(relative || inputPath, "file does not exist")
    throw readFailure(relative || inputPath, "cannot stat file")
  }
  if (!info.isFile()) throw readFailure(relative || inputPath, "target is not a regular file")
  if (info.size > policy.maxReadBytes) {
    throw new RlmError(
      "BUDGET_EXCEEDED",
      `context.read: file is ${info.size} bytes and exceeds the approved limit of ${policy.maxReadBytes}; file content was not materialized`,
    )
  }
  if (BINARY_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
    throw readFailure(relative, "binary file extension is not allowed")
  }

  const buffer = Buffer.allocUnsafe(policy.maxReadBytes + 1)
  let handle
  let total = 0
  try {
    handle = await open(target, "r")
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null)
      if (bytesRead === 0) break
      total += bytesRead
    }
  } catch {
    throw readFailure(relative, "bounded file read failed")
  } finally {
    await handle?.close().catch(() => undefined)
  }

  if (total > policy.maxReadBytes) {
    throw new RlmError(
      "BUDGET_EXCEEDED",
      `context.read: file grew beyond the approved limit of ${policy.maxReadBytes} bytes during the bounded read`,
    )
  }

  const bytes = buffer.subarray(0, total)
  if (bytes.includes(0)) throw readFailure(relative, "binary/NUL content is not allowed")
  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw readFailure(relative, "non-UTF-8 content is not allowed")
  }
  return { relative, content, bytes: total }
}

async function opRead(
  state: RlmRunState,
  policy: RlmContextPolicy,
  inputPath: string,
): Promise<string> {
  return (await readText(state, policy, inputPath)).content
}

async function opReadMany(
  state: RlmRunState,
  policy: RlmContextPolicy,
  paths: string[],
): Promise<ReadManyItem[]> {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_READ_MANY_FILES) {
    throw new RlmError("INVALID_ARGUMENT", `context.readMany: paths must be an array of 1-${MAX_READ_MANY_FILES} strings`)
  }
  for (const item of paths) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new RlmError("INVALID_ARGUMENT", "context.readMany: every path must be a non-empty string")
    }
  }
  const items: ReadManyItem[] = []
  for (const item of paths) {
    try {
      items.push({ path: item, content: await opRead(state, policy, item) })
    } catch (error) {
      items.push({ path: item, error: toErrorInfo(error) })
    }
  }
  return items
}

async function opGrep(
  state: RlmRunState,
  policy: RlmContextPolicy,
  pattern: string,
): Promise<GrepMatch[]> {
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    throw new RlmError("INVALID_ARGUMENT", "context.grep: pattern must be a non-empty string")
  }

  const evaluator = await createSafeRegexEvaluator(pattern)
  try {
    const files = await opFiles(state, policy, "")
    const matches: GrepMatch[] = []
    for (const file of files) {
      const item = await readText(state, policy, file)
      const lines = item.content.split("\n")
      const remaining = policy.maxGrepMatches - matches.length
      const indices = await evaluator.scan(item.content, remaining)
      for (const index of indices) {
        matches.push({ path: item.relative, line: index + 1, text: lines[index] })
        if (matches.length > policy.maxGrepMatches) {
          throw new RlmError("BUDGET_EXCEEDED", `context.grep: more than ${policy.maxGrepMatches} approved matches; full search cannot be returned`)
        }
      }
    }
    return matches
  } finally {
    await evaluator.close()
  }
}

async function opFiles(
  state: RlmRunState,
  policy: RlmContextPolicy,
  query: string,
): Promise<string[]> {
  if (typeof query !== "string") throw new RlmError("INVALID_ARGUMENT", "context.files: query must be a string")

  const needle = query.toLowerCase()
  const files: string[] = []
  let visitedDirs = 0
  let scannedEntries = 0
  let depthLimitHit = false
  let dirLimitHit = false
  let entryLimitHit = false

  const visit = async (relativeDir: string, depth: number): Promise<void> => {
    if (depthLimitHit || dirLimitHit || entryLimitHit) return
    if (files.length > policy.maxListEntries || files.length > MAX_GLOB_PATHS) return
    if (depth > 12) {
      depthLimitHit = true
      return
    }
    if (visitedDirs >= MAX_GLOB_DIRS) {
      dirLimitHit = true
      return
    }
    if (!mayTraverseRlmContextPath(relativeDir, policy)) return

    const target = await confinePath(state.workspaceRoot, relativeDir || ".")
    visitedDirs++
    try {
      const directory = await opendir(target)
      for await (const entry of directory) {
        scannedEntries++
        if (scannedEntries > MAX_CONTEXT_ENTRIES_SCANNED) {
          entryLimitHit = true
          return
        }
        if (entry.name === ".git" || entry.name === ".DS_Store") continue

        const relative = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name
        if (entry.isDirectory()) {
          if (mayTraverseRlmContextPath(relative, policy)) await visit(relative, depth + 1)
          if (depthLimitHit || dirLimitHit || entryLimitHit) return
          continue
        }
        if (!isRlmContextPathAllowed(relative, policy)) continue
        const name = entry.name.toLowerCase()
        if (name.includes(needle) || relative.toLowerCase().includes(needle)) files.push(relative)
        if (files.length > policy.maxListEntries || files.length > MAX_GLOB_PATHS) return
      }
    } catch {
      throw new RlmError("READ_FAILED", `context.files: cannot read approved directory: ${relativeDir || "."}`)
    }
  }

  await visit("", 0)
  if (files.length > policy.maxListEntries) {
    throw new RlmError("BUDGET_EXCEEDED", `context.files: more than ${policy.maxListEntries} approved paths; narrow the query`)
  }
  if (files.length > MAX_GLOB_PATHS) {
    throw new RlmError("BUDGET_EXCEEDED", `context.files: more than ${MAX_GLOB_PATHS} matching paths; narrow the query`)
  }
  if (depthLimitHit) {
    throw new RlmError("BUDGET_EXCEEDED", "context.files: directory depth exceeds the traversal limit; full result cannot be returned")
  }
  if (dirLimitHit) {
    throw new RlmError("BUDGET_EXCEEDED", `context.files: repository traversal exceeds ${MAX_GLOB_DIRS} directories; full result cannot be returned`)
  }
  if (entryLimitHit) {
    throw new RlmError("BUDGET_EXCEEDED", `context.files: repository traversal exceeds ${MAX_CONTEXT_ENTRIES_SCANNED} directory entries; full result cannot be returned`)
  }
  return files.sort((a, b) => a.localeCompare(b))
}
