#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { compareScores, parseArgs } from "./lib.mjs"

const args = parseArgs(process.argv.slice(2), ["normal", "rlm", "out"])
const [normal, rlm] = await Promise.all([
  readFile(args.normal, "utf8").then(JSON.parse),
  readFile(args.rlm, "utf8").then(JSON.parse),
])
const comparison = compareScores(normal, rlm)
await mkdir(dirname(args.out), { recursive: true })
await writeFile(args.out, JSON.stringify(comparison, null, 2) + "\n")
console.log(`${comparison.benchmark_id}: ΔF1=${comparison.quality.rlm_minus_normal.violation_f1} Δtokens=${comparison.efficiency.rlm_minus_normal.total_tokens} Δwall_ms=${comparison.efficiency.rlm_minus_normal.wall_ms}`)
