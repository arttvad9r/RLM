import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { discover } from "@opencode/client/service"
import { captureCodeBurnSessions, captureOpenCodeSessionTree, unwrap } from "./lib/opencode-evidence.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const corpusSize = process.env.RLM_PARTITION_BENCH_CORPUS?.trim() || "96"
const corpora = {
  "96": { corpus: "semantic-state-audit-v1", truth: "semantic-state-audit-v1.json" },
  "192": { corpus: "semantic-state-audit-v2-192", truth: "semantic-state-audit-v2-192.json" },
  "384": { corpus: "semantic-state-audit-v3-384", truth: "semantic-state-audit-v3-384.json" },
}
const selected = corpora[corpusSize]
if (!selected) throw new Error("RLM_PARTITION_BENCH_CORPUS must be 96, 192, or 384")
const corpusRoot = path.join(repoRoot, "benchmarks/corpora", selected.corpus)
const groundTruthFile = path.join(repoRoot, "benchmarks/ground-truth", selected.truth)
const outDir = path.join(repoRoot, `benchmarks/runs/2026-10-17-deepseek-v4.1-flash-structured-partition-${corpusSize}`)
const modelSpec = process.env.RLM_LIVE_OPENCODE_MODEL?.trim() || "ollama-cloud/deepseek-v4.1-flash"
const model = { providerID: modelSpec.slice(0, modelSpec.indexOf("/")), id: modelSpec.slice(modelSpec.indexOf("/") + 1) }
const strategies = ["round_robin", "balanced_chars"]
const orders = [["round_robin", "balanced_chars"], ["balanced_chars", "round_robin"], ["round_robin", "balanced_chars"]]
const rule = "Audit every assigned file. Report a file only when observable business, domain, or UI result state is mutated before a successful awaited asynchronous backend or worker operation completes. Loading, busy, pending, syncing, or similar lifecycle state before the await is not a violation. Result-state updates after the await, local-only mutations without backend coupling, and backend or mock adapter implementations are not violations. Return exactly one JSON array of project-relative violation paths and no prose."

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)) }, options.timeoutMs ?? 60_000)
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8")
    child.stdout.on("data", (x) => { stdout += x }); child.stderr.on("data", (x) => { stderr += x })
    child.on("error", reject)
    child.on("exit", (code) => {
      clearTimeout(timer)
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} failed\n${stdout}\n${stderr}`))
    })
  })
}

async function api(endpoint, route, init = {}) {
  const headers = { "content-type": "application/json" }
  if (endpoint.auth?.type === "basic") headers.authorization = `Basic ${Buffer.from(`${endpoint.auth.username}:${endpoint.auth.password}`).toString("base64")}`
  const response = await fetch(endpoint.url + route, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

function parseToolText(text) {
  let value = String(text).trim()
  for (let i = 0; i < 3; i++) {
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === "string") { value = parsed; continue }
      return parsed
    } catch {}
    const start = value.indexOf("{")
    const end = value.lastIndexOf("}")
    if (start >= 0 && end > start) { value = value.slice(start, end + 1); continue }
    break
  }
  throw new Error(`could not parse tool result: ${value.slice(0, 500)}`)
}

function score(predicted, truth) {
  const p = new Set(predicted), t = new Set(truth)
  let tp = 0, fp = 0, fn = 0
  for (const value of p) t.has(value) ? tp++ : fp++
  for (const value of t) if (!p.has(value)) fn++
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  return { tp, fp, fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const stat = (values) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values), values })

function summarize(runs, strategy) {
  const rows = runs.filter((run) => run.strategy === strategy)
  return {
    count: rows.length,
    f1: stat(rows.map((x) => x.quality.f1)),
    precision: stat(rows.map((x) => x.quality.precision)),
    recall: stat(rows.map((x) => x.quality.recall)),
    wall_ms: stat(rows.map((x) => x.wall_ms)),
    provider_cost_usd: stat(rows.map((x) => x.session_evidence.total_usage.cost_usd)),
    codeburn_cost_usd: stat(rows.map((x) => x.codeburn.total_cost_usd ?? 0)),
    root_cache_read: stat(rows.map((x) => x.session_evidence.root?.usage?.cache_read ?? 0)),
    child_cache_read: stat(rows.map((x) => x.session_evidence.descendant_usage.cache_read)),
    partition_char_skew: stat(rows.map((x) => x.partition_char_skew)),
  }
}

const createdRoots = []
async function runArm(endpoint, workspace, strategy) {
  const created = unwrap(await api(endpoint, "/api/session", {
    method: "POST",
    body: JSON.stringify({ title: `rlm-structured-${strategy}`, model, location: { directory: workspace } }),
  }))
  const rootSessionID = created.id
  createdRoots.push(rootSessionID)
  const mapInput = { query: "src/", instruction: rule, fanout: 4, output: "path_list", partition: strategy, failureMode: "strict" }
  const js = `return await tools.rlm_map(${JSON.stringify(mapInput)})`
  const prompt = `Use the execute tool exactly once. Do not inspect files with root tools and do not call ordinary subagents. Inside execute run exactly this JavaScript and do nothing else: ${js}. Return only the execute result.`
  const started = Date.now()
  await api(endpoint, `/api/session/${rootSessionID}/prompt`, { method: "POST", body: JSON.stringify({ text: prompt }) })
  await api(endpoint, `/api/experimental/session/${rootSessionID}/wait`, { method: "POST" })
  const wallMs = Date.now() - started
  const messages = unwrap(await api(endpoint, `/api/session/${rootSessionID}/message`))
  const parts = messages.filter((m) => m.type === "assistant" || m.info?.role === "assistant").flatMap((m) => m.content ?? m.parts ?? [])
  const executes = parts.filter((p) => p.type === "tool" && p.name === "execute")
  const mapCalls = executes.flatMap((execute) => execute.state?.metadata?.toolCalls ?? []).filter((call) => call.tool === "rlm_map")
  if (executes.length !== 1 || mapCalls.length !== 1) {
    throw new Error(`${strategy}: expected exactly one execute/rlm_map call, got execute=${executes.length} rlm_map=${mapCalls.length}`)
  }
  const execute = executes[0]
  const nested = mapCalls[0]
  if (execute.state?.status !== "completed") throw new Error(`${strategy}: execute failed: ${JSON.stringify(execute.state ?? null)}`)
  if (nested.status !== "completed") throw new Error(`${strategy}: rlm_map failed: ${JSON.stringify(nested)}`)
  const text = (execute.state?.content ?? []).filter((x) => x.type === "text").map((x) => x.text).join("\n")
  const result = parseToolText(text)
  if (result.schemaVersion !== 1 || result.kind !== "path_list") throw new Error(`${strategy}: unexpected structured contract`)
  if (result.partitionStrategy !== strategy || result.partitionCount !== 4 || (result.partitionErrors ?? []).length !== 0) throw new Error(`${strategy}: invalid partition result`)
  const predicted = [...new Set((result.paths ?? []).filter((x) => typeof x === "string"))].sort()
  const boundApi = (route, init = {}) => api(endpoint, route, init)
  const sessionEvidence = await captureOpenCodeSessionTree(boundApi, rootSessionID)
  if (sessionEvidence.descendant_count !== 4) throw new Error(`${strategy}: expected 4 descendants, got ${sessionEvidence.descendant_count}`)
  const ids = [sessionEvidence.root_session_id, ...sessionEvidence.descendants.map((row) => row.session_id)]
  const codeburn = captureCodeBurnSessions(ids)
  const chars = (result.partitionStats ?? []).map((row) => Number(row.sourceChars ?? 0))
  const partitionCharSkew = chars.length ? Math.max(...chars) - Math.min(...chars) : 0
  return {
    strategy,
    root_session_id: rootSessionID,
    wall_ms: wallMs,
    predicted,
    partition_stats: result.partitionStats,
    partition_char_skew: partitionCharSkew,
    session_evidence: sessionEvidence,
    codeburn,
  }
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rlm-structured-partition-"))
const snapshot = path.join(tempRoot, "package")
const workspace = path.join(tempRoot, "workspace")
let pluginSpec
let endpoint
try {
  await fs.cp(repoRoot, snapshot, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source)
      if (!rel) return true
      return !new Set([".git", "node_modules", ".opencode", ".tmp", "coverage"]).has(rel.split(path.sep)[0])
    },
  })
  await run("git", ["init", "-q"], { cwd: snapshot })
  await run("git", ["config", "user.name", "RLM Structured Benchmark"], { cwd: snapshot })
  await run("git", ["config", "user.email", "rlm-benchmark@example.invalid"], { cwd: snapshot })
  await run("git", ["add", "-A"], { cwd: snapshot })
  await run("git", ["commit", "-qm", "structured partition benchmark snapshot"], { cwd: snapshot })
  const snapshotCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: snapshot })).stdout.trim()

  pluginSpec = `git+${pathToFileURL(snapshot).href}`
  await run("opencode", ["plugin", "add", pluginSpec], { timeoutMs: 90_000 })
  endpoint = await discover()
  if (!endpoint) throw new Error("OpenCode service unavailable")

  await fs.mkdir(path.join(workspace, "src"), { recursive: true })
  for (const name of await fs.readdir(path.join(corpusRoot, "src"))) {
    await fs.copyFile(path.join(corpusRoot, "src", name), path.join(workspace, "src", name))
  }
  const truthJson = JSON.parse(await fs.readFile(groundTruthFile, "utf8"))
  const truth = truthJson.cases.filter((item) => item.class === "violation").map((item) => item.path).sort()

  const runs = []
  const failures = []
  for (let round = 0; round < orders.length; round++) {
    for (let position = 0; position < orders[round].length; position++) {
      const strategy = orders[round][position]
      let arm
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          arm = await runArm(endpoint, workspace, strategy)
          break
        } catch (error) {
          failures.push({ round: round + 1, position: position + 1, strategy, attempt, error: String(error) })
          console.log(`RETRY round=${round + 1} ${strategy} attempt=${attempt} error=${String(error).slice(0, 240)}`)
          if (attempt === 2) throw error
        }
      }
      arm.round = round + 1
      arm.position = position + 1
      arm.quality = score(arm.predicted, truth)
      runs.push(arm)
      console.log(`ROUND${round + 1} ${strategy} f1=${arm.quality.f1.toFixed(4)} p=${arm.quality.precision.toFixed(4)} r=${arm.quality.recall.toFixed(4)} wall=${arm.wall_ms} provider=$${arm.session_evidence.total_usage.cost_usd.toFixed(6)} codeburn=$${Number(arm.codeburn.total_cost_usd ?? 0).toFixed(6)} cb=${arm.codeburn.matched ?? 0}/${arm.codeburn.requested ?? 0} skew=${arm.partition_char_skew}`)
    }
  }

  const summary = Object.fromEntries(strategies.map((strategy) => [strategy, summarize(runs, strategy)]))
  const report = {
    benchmark_id: `semantic-state-audit-${corpusSize}-structured-partition`,
    model: modelSpec,
    snapshot_commit: snapshotCommit,
    design: { fanout: 4, concurrency_ceiling: 4, strategies, orders, runs_per_strategy: 3, production_rlm_map: true },
    runs,
    failures,
    summary,
    caveats: [
      "This compares only partition strategy; model, corpus, fanout, instruction and structured output contract are fixed.",
      "Provider cost comes from OpenCode session messages. CodeBurn is an optional API-equivalent cross-check captured before session cleanup.",
      "Three runs per strategy reduce but do not eliminate stochastic model variance.",
      `Corpus size: ${corpusSize} files.`,
    ],
  }
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, "partition-comparison.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(`MEDIANS ${JSON.stringify(Object.fromEntries(strategies.map((strategy) => [strategy, { f1: summary[strategy].f1.median, precision: summary[strategy].precision.median, recall: summary[strategy].recall.median, wall_ms: summary[strategy].wall_ms.median, provider_cost_usd: summary[strategy].provider_cost_usd.median, codeburn_cost_usd: summary[strategy].codeburn_cost_usd.median, partition_char_skew: summary[strategy].partition_char_skew.median }])) )}`)
} finally {
  if (!endpoint) endpoint = await discover().catch(() => undefined)
  if (endpoint) {
    for (const rootID of createdRoots) {
      const sessions = unwrap(await api(endpoint, "/api/session").catch(() => []))
      const ids = sessions.filter((session) => session.id === rootID || session.parentID === rootID).map((session) => session.id)
      for (const id of ids.reverse()) await api(endpoint, `/api/session/${id}`, { method: "DELETE" }).catch(() => {})
    }
  }
  if (pluginSpec) await run("opencode", ["plugin", "remove", pluginSpec], { timeoutMs: 30_000 }).catch(() => {})
  await fs.rm(tempRoot, { recursive: true, force: true })
}
