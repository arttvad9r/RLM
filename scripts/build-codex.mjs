import { chmodSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true })
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url))
const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.codex.json"], {
  cwd: root,
  stdio: "inherit",
})
if (result.status !== 0) process.exit(result.status ?? 1)
chmodSync(new URL("../dist/adapters/codex/mcp.js", import.meta.url), 0o755)
console.log("Codex adapter build: OK")
