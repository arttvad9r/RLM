import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const committedDist = path.join(root, "dist")
if (!existsSync(path.join(committedDist, "adapters", "codex", "mcp.js"))) {
  throw new Error("committed Codex dist is missing; run npm run build:codex")
}

function filesUnder(directory, base = directory) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...filesUnder(absolute, base))
    else if (entry.isFile()) result.push(path.relative(base, absolute).split(path.sep).join("/"))
  }
  return result.sort()
}

const temp = mkdtempSync(path.join(tmpdir(), "rlm-codex-dist-"))
try {
  const generated = path.join(temp, "dist")
  const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url))
  const run = spawnSync(process.execPath, [tsc, "-p", "tsconfig.codex.json", "--outDir", generated], {
    cwd: root,
    encoding: "utf8",
  })
  if (run.status !== 0) {
    process.stderr.write(run.stdout ?? "")
    process.stderr.write(run.stderr ?? "")
    process.exit(run.status ?? 1)
  }

  const committedFiles = filesUnder(committedDist)
  const generatedFiles = filesUnder(generated)
  if (JSON.stringify(committedFiles) !== JSON.stringify(generatedFiles)) {
    throw new Error(`Codex dist file set is stale\ncommitted=${JSON.stringify(committedFiles)}\ngenerated=${JSON.stringify(generatedFiles)}`)
  }
  for (const relative of generatedFiles) {
    const actual = readFileSync(path.join(committedDist, relative))
    const expected = readFileSync(path.join(generated, relative))
    if (!actual.equals(expected)) throw new Error(`Codex dist is stale: ${relative}`)
  }
} finally {
  rmSync(temp, { recursive: true, force: true })
}

console.log("Codex dist: OK")
