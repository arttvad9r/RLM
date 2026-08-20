#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const TEXT_EXTENSIONS = new Set([".json", ".md", ".mjs", ".ts", ".yml", ".yaml"])
const SKIP_DIRS = new Set([".git", "node_modules", "corpora", "ground-truth"])
const ALLOWED_ROOT_ENTRIES = new Set([
  ".dockerignore",
  ".git",
  ".github",
  ".gitignore",
  ".npmrc",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "agent",
  "benchmarks",
  "docs",
  "flake.lock",
  "flake.nix",
  "node_modules",
  "package-lock.json",
  "package.json",
  "plugin",
  "scripts",
  "tsconfig.json",
])
const FORBIDDEN = [
  "rlm/agent/",
  "rlm/plugin/",
  "rlm/benchmarks/",
  "evals/behavioral/",
  "src/planning/",
  "src/execution/",
  "contracts/v1/",
  "runtime/agents/autopilot",
  ".autopilot/",
  "/home/artt/Projects/opencode-autopilot",
]

const violations = []

const rootEntries = await readdir(ROOT, { withFileTypes: true })
for (const entry of rootEntries) {
  if (!ALLOWED_ROOT_ENTRIES.has(entry.name)) {
    violations.push(`unexpected top-level standalone entry: ${entry.name}`)
  }
}

async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await visit(absolute)
      continue
    }
    if (!entry.isFile() || !TEXT_EXTENSIONS.has(extname(entry.name))) continue
    const path = relative(ROOT, absolute).split("\\").join("/")
    if (path === "scripts/check-standalone.mjs") continue
    const text = await readFile(absolute, "utf8")
    for (const token of FORBIDDEN) {
      if (text.includes(token)) violations.push(`${path}: forbidden standalone coupling ${JSON.stringify(token)}`)
    }
  }
}

await visit(ROOT)
if (violations.length > 0) {
  console.error(violations.join("\n"))
  process.exit(1)
}
console.log("standalone coupling check: OK")
