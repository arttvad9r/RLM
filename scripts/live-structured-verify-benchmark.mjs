import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { discover } from "@opencode/client/service"
import { captureOpenCodeSessionTree, unwrap } from "./lib/opencode-evidence.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const corpusRoot = path.join(repoRoot, "benchmarks/corpora/semantic-state-audit-v1")
const groundTruthFile = path.join(repoRoot, "benchmarks/ground-truth/semantic-state-audit-v1.json")
const childModelSpec = process.env.RLM_LIVE_OPENCODE_MODEL?.trim()
if (!childModelSpec) throw new Error("RLM_LIVE_OPENCODE_MODEL is required and selects the semantic child model")
const rootModelSpec = process.env.RLM_VERIFY_BENCH_ROOT_MODEL?.trim() || childModelSpec
const repeats = Number(process.env.RLM_VERIFY_BENCH_REPEATS ?? "1")
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 3) throw new Error("RLM_VERIFY_BENCH_REPEATS must be 1, 2, or 3")
const shouldWrite = process.env.RLM_VERIFY_BENCH_WRITE === "1"
const outDir = path.join(repoRoot, "benchmarks/runs/2026-10-17-deepseek-v4.1-flash-structured-verify-96")
const fanout = 4
const positiveRule = "Report a file only when observable business, domain, or UI result state is mutated before a successful awaited asynchronous backend or worker operation completes. Loading, busy, pending, syncing, or similar lifecycle state before the await is not a violation. Result-state updates after the await, local-only mutations without backend coupling, and backend or mock adapter implementations are not violations. A string value such as pending-value written into an ordinary business/result field is still result state; the lifecycle exception applies only when the mutated field itself is clearly lifecycle state."
const mapInstruction = `Audit every assigned file. ${positiveRule} Return only matching project-relative paths.`
const verifyInstruction = `${positiveRule} Candidates are presumptively valid. Remove a candidate only when its source clearly proves one of the allowed exceptions above. If uncertain, keep it.`

function parseModel(spec) {
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) throw new Error(`invalid model spec: ${spec}`)
  const providerID = spec.slice(0, slash)
  const raw = spec.slice(slash + 1)
  const hash = raw.lastIndexOf("#")
  return hash < 0 ? { providerID, id: raw } : { providerID, id: raw.slice(0, hash), variant: raw.slice(hash + 1) }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)) }, options.timeoutMs ?? 60_000)
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8")
    child.stdout.on("data", (value) => { stdout += value }); child.stderr.on("data", (value) => { stderr += value })
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

function parseJsonish(text) {
  let value = String(text).trim()
  for (let i = 0; i < 4; i++) {
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
  throw new Error(`could not parse JSON value: ${value.slice(0, 700)}`)
}

function score(predicted, truth) {
  const p = new Set(predicted), t = new Set(truth)
  let tp = 0, fp = 0, fn = 0
  for (const value of p) t.has(value) ? tp++ : fp++
  for (const value of t) if (!p.has(value)) fn++
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0
  return { tp, fp, fn, precision, recall, f1 }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const stat = (values) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values), values })

function summarize(rows) {
  return {
    count: rows.length,
    baseline_f1: stat(rows.map((row) => row.baseline_quality.f1)),
    verified_f1: stat(rows.map((row) => row.verified_quality.f1)),
    f1_delta: stat(rows.map((row) => row.verified_quality.f1 - row.baseline_quality.f1)),
    baseline_precision: stat(rows.map((row) => row.baseline_quality.precision)),
    verified_precision: stat(rows.map((row) => row.verified_quality.precision)),
    baseline_recall: stat(rows.map((row) => row.baseline_quality.recall)),
    verified_recall: stat(rows.map((row) => row.verified_quality.recall)),
    baseline_fp: stat(rows.map((row) => row.baseline_quality.fp)),
    verified_fp: stat(rows.map((row) => row.verified_quality.fp)),
    baseline_fn: stat(rows.map((row) => row.baseline_quality.fn)),
    verified_fn: stat(rows.map((row) => row.verified_quality.fn)),
    correct_fp_removals: stat(rows.map((row) => row.removal_quality.correct_fp_removals)),
    incorrect_tp_removals: stat(rows.map((row) => row.removal_quality.incorrect_tp_removals)),
    candidate_count: stat(rows.map((row) => row.scan_paths.length)),
    wall_ms: stat(rows.map((row) => row.wall_ms)),
    provider_cost_usd: stat(rows.map((row) => row.session_evidence.total_usage.cost_usd)),
  }
}


async function installBenchmarkTool(snapshotRoot) {
  const pluginFile = path.join(snapshotRoot, "plugin/rlm.ts")
  let source = await fs.readFile(pluginFile, "utf8")
  const needle = `      })
    })

    void (async () => {`
  if (!source.includes(needle)) throw new Error("benchmark tool injection point not found")
  const mapInput = { query: "src/", instruction: mapInstruction, fanout, output: "path_list", partition: "balanced_chars", failureMode: "strict" }
  const addition = `      })

      editor.add({
        name: "rlm_benchmark_paired",
        description: "Benchmark-only fixed paired map/verify wrapper.",
        input: { type: "object", properties: {}, additionalProperties: false },
        async execute(_input, context) {
          const mapOutcome = await executeRlmMap(host, {
            input: ${JSON.stringify(mapInput)},
            parentSessionID: context.sessionID, directory, worktree, messageID: context.messageID, abort: context.signal, log,
          })
          const scan = JSON.parse(mapOutcome.output)
          const verifyOutcome = await executeRlmVerify(host, {
            input: { candidates: scan.paths, instruction: ${JSON.stringify(verifyInstruction)}, fanout: ${fanout}, partition: "balanced_chars", failureMode: "strict" },
            parentSessionID: context.sessionID, directory, worktree, messageID: context.messageID, abort: context.signal, log,
          })
          const verify = JSON.parse(verifyOutcome.output)
          return { content: JSON.stringify({ scan, verify }), metadata: { benchmarkOnly: true } }
        },
      })
    })

    void (async () => {`
  source = source.replace(needle, addition)
  await fs.writeFile(pluginFile, source)
}

const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config")
const hostConfigFile = path.join(configHome, "rlm", "host.json")
let originalHostConfig

const createdRoots = []
async function deleteTree(endpoint, rootSessionID) {
  const sessions = unwrap(await api(endpoint, "/api/session").catch(() => []))
  const ids = sessions.filter((session) => session.id === rootSessionID || session.parentID === rootSessionID).map((session) => session.id)
  for (const id of ids.reverse()) await api(endpoint, `/api/session/${id}`, { method: "DELETE" }).catch(() => {})
}

async function runPaired(endpoint, workspace, model, truth, round) {
  const created = unwrap(await api(endpoint, "/api/session", {
    method: "POST",
    body: JSON.stringify({ title: `rlm-structured-verify-96-paired-${round}`, model, location: { directory: workspace } }),
  }))
  const rootSessionID = created.id
  createdRoots.push(rootSessionID)

  const executeJs = `return await tools.rlm_benchmark_paired({})`
  const prompt = `Use the execute tool exactly once. Do not inspect files with root tools and do not call ordinary subagents. Inside execute run exactly this JavaScript and nothing else: ${executeJs}. Return only the execute result.`
  const started = Date.now()
  await api(endpoint, `/api/session/${rootSessionID}/prompt`, { method: "POST", body: JSON.stringify({ text: prompt }) })
  await api(endpoint, `/api/experimental/session/${rootSessionID}/wait`, { method: "POST" })
  const wallMs = Date.now() - started

  const rootMessages = unwrap(await api(endpoint, `/api/session/${rootSessionID}/message`))
  const parts = rootMessages.filter((message) => message.type === "assistant" || message.info?.role === "assistant").flatMap((message) => message.content ?? message.parts ?? [])
  const topTools = parts.filter((part) => part.type === "tool")
  const executes = topTools.filter((part) => part.name === "execute")
  if (topTools.some((part) => part.name !== "execute")) throw new Error("paired: root used a top-level tool other than execute")
  if (executes.length !== 1 || executes[0].state?.status !== "completed") throw new Error("paired: expected exactly one completed execute call")
  const nested = executes[0].state?.metadata?.toolCalls ?? []
  const pairedCalls = nested.filter((call) => call.tool === "rlm_benchmark_paired")
  if (pairedCalls.length !== 1 || pairedCalls[0].status !== "completed") throw new Error("paired: expected exactly one completed benchmark wrapper call")

  const rendered = (executes[0].state?.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n")
  const parsed = parseJsonish(rendered)
  const scan = parsed.scan
  const verify = parsed.verify
  if (scan?.schemaVersion !== 1 || scan?.kind !== "path_list" || scan?.partitionCount !== fanout || (scan?.partitionErrors ?? []).length !== 0) {
    throw new Error("paired: invalid map contract")
  }
  if (verify?.schemaVersion !== 1 || verify?.kind !== "conservative_filter" || verify?.verification?.uncertainty !== "keep" || (verify?.partitionErrors ?? []).length !== 0) {
    throw new Error("paired: invalid conservative verification contract")
  }

  const scanPaths = [...new Set((scan.paths ?? []).filter((value) => typeof value === "string"))].sort()
  const keptPaths = [...new Set((verify.keptPaths ?? []).filter((value) => typeof value === "string"))].sort()
  const removedPaths = [...new Set((verify.removedPaths ?? []).filter((value) => typeof value === "string"))].sort()
  const scanSet = new Set(scanPaths)
  if (keptPaths.some((value) => !scanSet.has(value)) || removedPaths.some((value) => !scanSet.has(value))) {
    throw new Error("paired: verifier returned a path outside the exact baseline candidate set")
  }
  if (new Set([...keptPaths, ...removedPaths]).size !== scanPaths.length || keptPaths.length + removedPaths.length !== scanPaths.length) {
    throw new Error("paired: kept+removed must form an exact partition of baseline candidates")
  }

  const sessionEvidence = await captureOpenCodeSessionTree((route, init) => api(endpoint, route, init), rootSessionID)
  const expectedDescendants = Number(scan.partitionCount ?? 0) + Number(verify.partitionCount ?? 0) + Number(verify.confirmation?.partitionCount ?? 0)
  if (sessionEvidence.descendant_count !== expectedDescendants) throw new Error(`paired: expected ${expectedDescendants} descendants, got ${sessionEvidence.descendant_count}`)
  const childModels = [...new Set(sessionEvidence.descendants.flatMap((row) => row.models))]
  const expectedChild = parseModel(childModelSpec)
  const expectedModel = `${expectedChild.providerID}/${expectedChild.id}${expectedChild.variant ? `#${expectedChild.variant}` : "#default"}`
  if (childModels.length !== 1 || childModels[0] !== expectedModel) throw new Error(`paired: unexpected child models ${JSON.stringify(childModels)}`)

  const truthSet = new Set(truth)
  return {
    round,
    root_session_id: rootSessionID,
    wall_ms: wallMs,
    scan_paths: scanPaths,
    kept_paths: keptPaths,
    removed_paths: removedPaths,
    baseline_quality: score(scanPaths, truth),
    verified_quality: score(keptPaths, truth),
    removal_quality: {
      correct_fp_removals: removedPaths.filter((value) => !truthSet.has(value)).length,
      incorrect_tp_removals: removedPaths.filter((value) => truthSet.has(value)).length,
    },
    verification_confirmation: verify.confirmation,
    session_evidence: sessionEvidence,
  }
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rlm-structured-verify-benchmark-"))
const snapshot = path.join(tempRoot, "package")
const workspace = path.join(tempRoot, "workspace")
let pluginSpec
let endpoint
try {
  try { originalHostConfig = await fs.readFile(hostConfigFile) } catch (error) { if (error.code !== "ENOENT") throw error }
  const fixedChild = parseModel(childModelSpec)
  const baseConfig = originalHostConfig ? JSON.parse(originalHostConfig.toString("utf8")) : { version: 1 }
  const benchmarkConfig = {
    ...baseConfig,
    version: 1,
    child_model: {
      strategy: "fixed",
      provider: fixedChild.providerID,
      model: fixedChild.id,
      ...(fixedChild.variant ? { variant: fixedChild.variant } : {}),
    },
  }
  await fs.mkdir(path.dirname(hostConfigFile), { recursive: true })
  await fs.writeFile(hostConfigFile, JSON.stringify(benchmarkConfig, null, 2) + "\n")

  await fs.cp(repoRoot, snapshot, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source)
      if (!rel) return true
      return !new Set([".git", "node_modules", ".opencode", ".tmp", "coverage"]).has(rel.split(path.sep)[0])
    },
  })
  await installBenchmarkTool(snapshot)
  await run("git", ["init", "-q"], { cwd: snapshot })
  await run("git", ["config", "user.name", "RLM Structured Verify Benchmark"], { cwd: snapshot })
  await run("git", ["config", "user.email", "rlm-benchmark@example.invalid"], { cwd: snapshot })
  await run("git", ["add", "-A"], { cwd: snapshot })
  await run("git", ["commit", "-qm", "structured verify benchmark snapshot"], { cwd: snapshot })
  const snapshotCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: snapshot })).stdout.trim()

  pluginSpec = `git+${pathToFileURL(snapshot).href}`
  await run("opencode", ["plugin", "add", pluginSpec], { timeoutMs: 90_000 })
  endpoint = await discover()
  if (!endpoint) throw new Error("OpenCode service unavailable")

  await fs.mkdir(path.join(workspace, "src"), { recursive: true })
  for (const name of await fs.readdir(path.join(corpusRoot, "src"))) await fs.copyFile(path.join(corpusRoot, "src", name), path.join(workspace, "src", name))
  const truthJson = JSON.parse(await fs.readFile(groundTruthFile, "utf8"))
  const truth = truthJson.cases.filter((item) => item.class === "violation").map((item) => item.path).sort()
  const model = parseModel(rootModelSpec)
  const rows = []
  const failures = []

  for (let round = 1; round <= repeats; round++) {
    let result
    for (let attempt = 1; attempt <= 2; attempt++) {
      const beforeCount = createdRoots.length
      try {
        result = await runPaired(endpoint, workspace, model, truth, round)
        break
      } catch (error) {
        const attemptedRoot = createdRoots.length > beforeCount ? createdRoots.at(-1) : undefined
        failures.push({ round, attempt, error: String(error) })
        console.log(`RETRY round=${round} attempt=${attempt} ${String(error).slice(0, 300)}`)
        if (attemptedRoot) await deleteTree(endpoint, attemptedRoot)
        if (attempt === 2) throw error
      }
    }
    rows.push(result)
    console.log(`ROUND${round} baseline_f1=${result.baseline_quality.f1.toFixed(4)} verified_f1=${result.verified_quality.f1.toFixed(4)} delta=${(result.verified_quality.f1 - result.baseline_quality.f1).toFixed(4)} baseline_p=${result.baseline_quality.precision.toFixed(4)} verified_p=${result.verified_quality.precision.toFixed(4)} baseline_r=${result.baseline_quality.recall.toFixed(4)} verified_r=${result.verified_quality.recall.toFixed(4)} baseline_fp=${result.baseline_quality.fp} verified_fp=${result.verified_quality.fp} baseline_fn=${result.baseline_quality.fn} verified_fn=${result.verified_quality.fn} candidates=${result.scan_paths.length} removed=${result.removed_paths.length} fp_removed=${result.removal_quality.correct_fp_removals} tp_removed=${result.removal_quality.incorrect_tp_removals} children=${result.session_evidence.descendant_count} wall=${result.wall_ms} provider=$${result.session_evidence.total_usage.cost_usd.toFixed(6)}`)
  }

  const summary = summarize(rows)
  const totalProviderCost = rows.reduce((sum, row) => sum + row.session_evidence.total_usage.cost_usd, 0)
  const report = {
    benchmark_id: "semantic-state-audit-v1-96-production-structured-verification-paired",
    root_model: rootModelSpec,
    child_model: childModelSpec,
    snapshot_commit: snapshotCommit,
    design: {
      corpus_files: 96,
      truth_violations: truth.length,
      fanout,
      partition: "balanced_chars",
      failure_mode: "strict",
      repeats,
      paired_candidate_set: true,
      baseline: "exact rlm_map path_list candidates",
      treatment: "rlm_verify applied to the exact same candidate array",
      production_rlm_map: true,
      production_rlm_verify: true,
      fixed_child_routing: true,
      verifier_prompt_hardening: "exception requires proof from mutated field/control-state semantics; suggestive value/name alone is insufficient",
      independent_confirmation: true,
      verify_fanout_max: 8,
      benchmark_wrapper: "temporary plugin wrapper calls production executeRlmMap then executeRlmVerify with fixed inputs",
    },
    runs: rows,
    failures,
    summary,
    total_provider_cost_usd: totalProviderCost,
    caveats: [
      "Verification can remove false positives but cannot recover candidates missed by the shared first-stage scan.",
      "Each round is paired: baseline and verified quality are scored from the exact same scan candidate set.",
      "A temporary benchmark-only plugin wrapper removes model-written map/verify glue while calling the production executeRlmMap and executeRlmVerify implementations with the real OpenCode host, sandbox, turn governor, and child isolation.",
      "The verifier is asymmetric: candidates are presumptively valid and uncertainty means KEEP.",
      "Semantic children are routed through the production trusted fixed-child policy; the root model only triggers the benchmark-only wrapper and does not perform classification.",
      "Provider-reported cost includes the shared scan, verifier, and root orchestration for accepted rounds; discarded retry attempts are listed in failures but excluded from successful-round cost summaries.",
      "This 96-file synthetic corpus is quality evidence for this workload only; it does not justify universal defaults.",
    ],
  }
  if (shouldWrite) {
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(path.join(outDir, "paired-production-verification.json"), JSON.stringify(report, null, 2) + "\n")
  }
  console.log(`MEDIANS ${JSON.stringify({ baseline_f1: summary.baseline_f1.median, verified_f1: summary.verified_f1.median, f1_delta: summary.f1_delta.median, baseline_precision: summary.baseline_precision.median, verified_precision: summary.verified_precision.median, baseline_recall: summary.baseline_recall.median, verified_recall: summary.verified_recall.median, baseline_fp: summary.baseline_fp.median, verified_fp: summary.verified_fp.median, baseline_fn: summary.baseline_fn.median, verified_fn: summary.verified_fn.median, correct_fp_removals: summary.correct_fp_removals.median, incorrect_tp_removals: summary.incorrect_tp_removals.median, candidate_count: summary.candidate_count.median, wall_ms: summary.wall_ms.median, provider_cost_usd: summary.provider_cost_usd.median, total_provider_cost_usd: totalProviderCost, written: shouldWrite })}`)
} finally {
  if (!endpoint) endpoint = await discover().catch(() => undefined)
  if (endpoint) for (const rootID of createdRoots) await deleteTree(endpoint, rootID)
  if (pluginSpec) await run("opencode", ["plugin", "remove", pluginSpec], { timeoutMs: 30_000 }).catch(() => {})
  if (originalHostConfig) await fs.writeFile(hostConfigFile, originalHostConfig)
  else await fs.rm(hostConfigFile, { force: true }).catch(() => {})
  await fs.rm(tempRoot, { recursive: true, force: true })
}
