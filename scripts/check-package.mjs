import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

if (pkg.private === true) throw new Error("package must not be private")
if (pkg.license !== "MIT") throw new Error("package license must be MIT")
if (pkg.exports !== "./plugin/rlm.ts") throw new Error("package root export must point to plugin/rlm.ts")

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8", ...options })
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  return result
}

const dryRun = run("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"])
const parsed = JSON.parse(dryRun.stdout)
const report = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]
if (!report || !Array.isArray(report.files)) throw new Error("npm pack did not return a file manifest")

const paths = new Set(report.files.map((file) => file.path))
const required = [
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "agent/rlm.md",
  "plugin/rlm.ts",
  "plugin/rlm-lib/constants.ts",
  "plugin/rlm-lib/context.ts",
  "plugin/rlm-lib/sandbox.ts",
  "plugin/rlm-runner/runner.ts",
  "plugin/rlm-runner/generated-worker.ts",
  "plugin/rlm-runner/write-all.ts",
]
for (const file of required) {
  if (!paths.has(file)) throw new Error(`published package is missing ${file}`)
}
for (const file of paths) {
  if (file.startsWith("benchmarks/") || file.startsWith(".github/") || file.startsWith("scripts/") || file.startsWith("plugin/tests") || file === "plugin/tsconfig.host.json") {
    throw new Error(`published package contains development-only path ${file}`)
  }
}

const tempRoot = mkdtempSync(path.join(tmpdir(), "opencode-rlm-pack-"))
try {
  const packDir = path.join(tempRoot, "pack")
  const appDir = path.join(tempRoot, "app")
  run(process.execPath, ["-e", `const fs=require('node:fs'); fs.mkdirSync(${JSON.stringify(packDir)},{recursive:true}); fs.mkdirSync(${JSON.stringify(appDir)},{recursive:true})`])
  const packed = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir])
  const packedParsed = JSON.parse(packed.stdout)
  const packedReport = Array.isArray(packedParsed) ? packedParsed[0] : Object.values(packedParsed)[0]
  const tarball = path.join(packDir, packedReport.filename)
  const install = spawnSync("npm", ["install", "--ignore-scripts", tarball], { cwd: appDir, encoding: "utf8" })
  if (install.status !== 0) {
    process.stderr.write(install.stdout ?? "")
    process.stderr.write(install.stderr ?? "")
    throw new Error("packed artifact failed to install in an empty project")
  }
  const installedRoot = path.join(appDir, "node_modules", "opencode-rlm")
  for (const file of required) {
    if (!existsSync(path.join(installedRoot, file))) throw new Error(`installed artifact is missing ${file}`)
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}

console.log(`package artifact: OK (${report.files.length} files, ${report.size} bytes)`)
