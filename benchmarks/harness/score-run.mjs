#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { corpusAggregate, parseArgs, scoreRun, sha256 } from "./lib.mjs"

const args = parseArgs(process.argv.slice(2), ["ground-truth", "manifest", "corpus", "task-prompt", "run", "out"])
const [groundTruthBytes, manifestBytes, taskPromptBytes, runBytes] = await Promise.all([
  readFile(args["ground-truth"]),
  readFile(args.manifest),
  readFile(args["task-prompt"]),
  readFile(args.run),
])

const corpusSrc = join(args.corpus, "src")
const corpusNames = (await readdir(corpusSrc)).filter((name) => name.endsWith(".ts")).sort()
const corpusEntries = await Promise.all(corpusNames.map(async (name) => ({
  name,
  content: await readFile(join(corpusSrc, name), "utf8"),
})))

const groundTruth = JSON.parse(groundTruthBytes.toString("utf8"))
const manifest = JSON.parse(manifestBytes.toString("utf8"))
const run = JSON.parse(runBytes.toString("utf8"))
const report = scoreRun({
  groundTruth,
  manifest,
  run,
  groundTruthSha256: sha256(groundTruthBytes),
  corpusAggregateSha256: corpusAggregate(corpusEntries),
  taskPromptSha256: sha256(taskPromptBytes),
  runSha256: sha256(runBytes),
})

await mkdir(dirname(args.out), { recursive: true })
await writeFile(args.out, JSON.stringify(report, null, 2) + "\n")
console.log(`${report.benchmark_id} ${report.run.mode}: TP=${report.counts.tp} FP=${report.counts.fp} FN=${report.counts.fn} TN=${report.counts.tn} F1=${report.metrics.violation_f1}`)
