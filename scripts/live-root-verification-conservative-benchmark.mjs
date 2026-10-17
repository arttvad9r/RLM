import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { discover } from "@opencode/client/service"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const corpusRoot = path.join(repoRoot, "benchmarks/corpora/semantic-state-audit-v3-384")
const groundTruthFile = path.join(repoRoot, "benchmarks/ground-truth/semantic-state-audit-v3-384.json")
const outDir = path.join(repoRoot, "benchmarks/runs/2026-10-17-gpt-6-sol-low-root-verify-conservative-384")
const rootModel = { providerID: "openai", id: "gpt-6-sol", variant: "low" }
const fanout = 16
const arms = ["verify"]
const orders = [["verify"], ["verify"], ["verify"]]
const rule = "Audit every assigned file. Report a file only when observable business, domain, or UI result state is mutated before a successful awaited asynchronous backend or worker operation completes. Loading, busy, pending, syncing, or similar lifecycle state before the await is not a violation. Result-state updates after the await, local-only mutations without backend coupling, and backend or mock adapter implementations are not violations. Return exactly one JSON array of project-relative violation paths and no prose."

const rlmCode = `const paths = (await context.files("src/")).sort();
const files = [];
for (let i = 0; i < paths.length; i += 64) files.push(...await context.readMany(paths.slice(i, i + 64)));
const groups = Array.from({ length: ${fanout} }, () => []);
for (let i = 0; i < files.length; i++) groups[i % ${fanout}].push(files[i]);
const rule = ${JSON.stringify(rule)};
const nl = String.fromCharCode(10);
const prompts = groups.map((group) => rule + nl + group.map((file) => JSON.stringify({ path: file.path, source: file.content || "" })).join(nl));
const answers = await llm.batch(prompts);
const found = [];
for (const answer of answers) {
  const text = String(answer).trim(); const start = text.indexOf("["); const end = text.lastIndexOf("]");
  if (start >= 0 && end >= start) for (const value of JSON.parse(text.slice(start, end + 1))) if (typeof value === "string") found.push(value);
}
return { violations: [...new Set(found)].sort() };`

const bundleCode = rlmCode.replace(
  "return { violations: [...new Set(found)].sort() };",
  "const candidates = [...new Set(found)].sort(); const byPath = new Map(files.map((file) => [file.path, file.content || \"\"])); return { candidates: candidates.map((path) => ({ path, source: byPath.get(path) || \"\" })) };",
)

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd ?? repoRoot, env: options.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)) }, options.timeoutMs ?? 60_000)
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8")
    child.stdout.on("data", (x) => { stdout += x }); child.stderr.on("data", (x) => { stderr += x })
    child.on("error", reject)
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} failed\n${stdout}\n${stderr}`)) })
  })
}

async function api(endpoint, route, init = {}) {
  const headers = { "content-type": "application/json" }
  if (endpoint.auth?.type === "basic") headers.authorization = `Basic ${Buffer.from(`${endpoint.auth.username}:${endpoint.auth.password}`).toString("base64")}`
  const response = await fetch(endpoint.url + route, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

function unwrap(x) { return x?.data ?? x }
function sumUsage(messages) {
  const out = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost_usd: 0 }
  for (const message of messages) {
    if (message.type !== "assistant" && message.info?.role !== "assistant") continue
    const info = message.info ?? message; const t = info.tokens ?? message.tokens ?? {}
    out.input += Number(t.input ?? 0); out.output += Number(t.output ?? 0); out.reasoning += Number(t.reasoning ?? 0)
    out.cache_read += Number(t.cache?.read ?? 0); out.cache_write += Number(t.cache?.write ?? 0); out.cost_usd += Number(info.cost ?? message.cost ?? 0)
  }
  return out
}
function parseObject(text) {
  let value = String(text).trim()
  for (let i = 0; i < 4; i++) {
    try { const parsed = JSON.parse(value); if (typeof parsed === "string") { value = parsed; continue } return parsed } catch {}
    const start = value.indexOf("{"); const end = value.lastIndexOf("}")
    if (start >= 0 && end > start) { value = value.slice(start, end + 1); continue }
    break
  }
  throw new Error(`Could not parse JSON object: ${value.slice(0, 700)}`)
}
function score(predicted, truth) {
  const p = new Set(predicted), t = new Set(truth); let tp = 0, fp = 0, fn = 0
  for (const x of p) t.has(x) ? tp++ : fp++
  for (const x of t) if (!p.has(x)) fn++
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0
  return { tp, fp, fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 }
}
function logical(usage) { return usage.input + usage.output + usage.cache_read }
function modelName(message) {
  const info = message.info ?? message
  const m = info.model ?? message.model
  if (!m) return undefined
  const provider = m.providerID ?? m.providerId
  const id = m.id ?? m.modelID
  const variant = m.variant
  return provider && id ? `${provider}/${id}${variant ? `#${variant}` : ""}` : undefined
}

const createdSessions = []
async function setChildPolicy(configFile, baseConfig, arm) {
  const config = structuredClone(baseConfig)
  config.version = 1
  config.child_model = arm === "luna_children"
    ? { strategy: "fixed", provider: "openai", model: "gpt-6-luna", variant: "low" }
    : { strategy: "inherit" }
  await fs.mkdir(path.dirname(configFile), { recursive: true })
  await fs.writeFile(configFile, JSON.stringify(config, null, 2) + "\n")
}

async function runArm(endpoint, workspace, arm) {
  const created = unwrap(await api(endpoint, "/api/session", { method: "POST", body: JSON.stringify({ title: `rlm-root-verify-${arm}`, model: rootModel, location: { directory: workspace } }) }))
  const sessionId = created.id; createdSessions.push(sessionId)
  const mode = arm === "verify" ? "bundle" : "scan"
  const executeJs = `return await tools.rlm_benchmark({ mode: ${JSON.stringify(mode)} })`
  const prompt = arm === "scan"
    ? `Use the execute tool exactly once. Do not inspect files with root tools and do not call ordinary subagents. Inside execute run exactly this JavaScript: ${executeJs}. Return only the execute result.`
    : `Use the execute tool exactly once. Do not inspect files with root tools and do not call ordinary subagents before or after execute. The execute code must be exactly this single line, character-for-character, with no trailing period or other punctuation:
${executeJs}
The result contains candidate objects with path and source from an exhaustive 16-child scan. Treat each candidate as presumptively valid and reject it only when the source clearly proves an allowed exception. Apply this rule: ${rule} Important: a value such as "pending-value" written into an ordinary business/result field is still a result-state mutation; the lifecycle exception applies only when the mutated field itself is clearly a lifecycle field such as loading, busy, pending, syncing, or status. If uncertain, keep the candidate. Return exactly one JSON object {"violations":[...]} with retained candidates, sorted lexicographically, and no prose.`
  const started = Date.now()
  await api(endpoint, `/api/session/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ text: prompt }) })
  await api(endpoint, `/api/experimental/session/${sessionId}/wait`, { method: "POST" })
  const wallMs = Date.now() - started
  const messages = unwrap(await api(endpoint, `/api/session/${sessionId}/message`))
  const assistants = messages.filter((m) => m.type === "assistant" || m.info?.role === "assistant")
  const parts = assistants.flatMap((m) => m.content ?? m.parts ?? [])
  const topTools = parts.filter((p) => p.type === "tool")
  const executeCalls = topTools.filter((p) => p.name === "execute")
  if (executeCalls.length !== 1 || executeCalls[0].state?.status !== "completed") throw new Error(`${arm}: expected one completed execute call`)
  if (topTools.some((p) => p.name !== "execute")) throw new Error(`${arm}: root used forbidden extra tools`)
  const execute = executeCalls[0]
  const call = (execute.state?.metadata?.toolCalls ?? []).find((x) => x.tool === "rlm_benchmark")
  if (!call || call.status !== "completed") throw new Error(`${arm}: rlm_benchmark failed ${JSON.stringify(execute.state)}`)
  const toolText = (execute.state?.content ?? []).filter((x) => x.type === "text").map((x) => x.text).join("\n")
  let parsed, candidateCount = 0, candidateSourceChars = 0
  if (arm === "scan") {
    parsed = parseObject(toolText)
  } else {
    const bundle = parseObject(toolText)
    candidateCount = Array.isArray(bundle.candidates) ? bundle.candidates.length : 0
    candidateSourceChars = Array.isArray(bundle.candidates) ? bundle.candidates.reduce((sum, item) => sum + String(item?.source ?? "").length, 0) : 0
    const textParts = parts.filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text)
    for (let i = textParts.length - 1; i >= 0; i--) {
      try { const value = parseObject(textParts[i]); if (Array.isArray(value?.violations)) { parsed = value; break } } catch {}
    }
    if (!parsed) throw new Error("verify: root returned no parseable violations object")
  }
  const predicted = [...new Set((parsed.violations ?? []).filter((x) => typeof x === "string"))].sort()
  const sessions = unwrap(await api(endpoint, "/api/session")); const children = sessions.filter((s) => s.parentID === sessionId)
  let childUsage = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost_usd: 0 }; const childModels = []
  for (const child of children) {
    const cm = unwrap(await api(endpoint, `/api/session/${child.id}/message`)); const u = sumUsage(cm)
    for (const key of Object.keys(childUsage)) childUsage[key] += u[key]
    const observed = [...cm].reverse().map(modelName).find(Boolean); if (observed) childModels.push(observed)
  }
  const rootUsage = sumUsage(messages)
  return {
    arm, session_id: sessionId, wall_ms: wallMs, predicted_violations: predicted,
    root_usage: rootUsage, child_usage: childUsage, child_session_count: children.length,
    child_models: [...new Set(childModels)].sort(), candidate_count: candidateCount, candidate_source_chars: candidateSourceChars,
    token_accounting: { root_logical_tokens: logical(rootUsage), child_logical_tokens: logical(childUsage), total_logical_tokens: logical(rootUsage) + logical(childUsage) },
  }
}

async function installBenchmarkTool(snapshotRoot) {
  const helperSource = [
    `export const scanCode = ${JSON.stringify(rlmCode)}`,
    `export const bundleCode = ${JSON.stringify(bundleCode)}`,
    "",
  ].join("\n")
  await fs.writeFile(path.join(snapshotRoot, "plugin/rlm-lib/benchmark-helper.ts"), helperSource)
  const pluginFile = path.join(snapshotRoot, "plugin/rlm.ts")
  let source = await fs.readFile(pluginFile, "utf8")
  source = source.replace(
    'import { RLM_EXEC_DESCRIPTION } from "./rlm-lib/tool-description.ts"',
    'import { RLM_EXEC_DESCRIPTION } from "./rlm-lib/tool-description.ts"\nimport { scanCode, bundleCode } from "./rlm-lib/benchmark-helper.ts"',
  )
  const needle = "      })\n    })\n\n    void (async () => {"
  const addition = [
    "      })", "", "      editor.add({", "        name: \"rlm_benchmark\",", "        description: \"Benchmark-only fixed scan/bundle helper.\",",
    "        input: { type: \"object\", properties: { mode: { type: \"string\", enum: [\"scan\", \"bundle\"] } }, required: [\"mode\"], additionalProperties: false },",
    "        async execute(input, context) {",
    "          const code = (input as { mode?: unknown }).mode === \"bundle\" ? bundleCode : scanCode",
    "          const outcome = await executeRlmExec(host, { code, parentSessionID: context.sessionID, directory, worktree, messageID: context.messageID, abort: context.signal, log })",
    "          return { content: outcome.output, metadata: outcome.metadata }", "        },", "      })", "    })", "", "    void (async () => {",
  ].join("\n")
  if (!source.includes(needle)) throw new Error("benchmark tool injection point not found")
  await fs.writeFile(pluginFile, source.replace(needle, addition))
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
function summarize(runs, arm) {
  const xs = runs.filter((x) => x.arm === arm); const stat = (values) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values), values })
  return { count: xs.length, f1: stat(xs.map((x) => x.quality.f1)), precision: stat(xs.map((x) => x.quality.precision)), recall: stat(xs.map((x) => x.quality.recall)), tp: stat(xs.map((x) => x.quality.tp)), fp: stat(xs.map((x) => x.quality.fp)), fn: stat(xs.map((x) => x.quality.fn)), root_logical_tokens: stat(xs.map((x) => x.token_accounting.root_logical_tokens)), child_logical_tokens: stat(xs.map((x) => x.token_accounting.child_logical_tokens)), total_logical_tokens: stat(xs.map((x) => x.token_accounting.total_logical_tokens)), wall_ms: stat(xs.map((x) => x.wall_ms)) }
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rlm-routing-benchmark-")); const snapshot = path.join(tempRoot, "package"); const workspace = path.join(tempRoot, "workspace")
const configHome = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config"); const configFile = path.join(configHome, "rlm", "host.json")
let originalConfig; try { originalConfig = await fs.readFile(configFile) } catch (e) { if (e.code !== "ENOENT") throw e }
let baseConfig = { version: 1 }; if (originalConfig) baseConfig = JSON.parse(originalConfig.toString("utf8"))
let pluginSpec
try {
  await fs.cp(repoRoot, snapshot, { recursive: true, filter(source) { const rel = path.relative(repoRoot, source); if (!rel) return true; return !new Set([".git", "node_modules", ".opencode", ".tmp", "coverage"]).has(rel.split(path.sep)[0]) } })
  await installBenchmarkTool(snapshot)
  await run("git", ["init", "-q"], { cwd: snapshot }); await run("git", ["config", "user.name", "RLM Benchmark"], { cwd: snapshot }); await run("git", ["config", "user.email", "benchmark@example.invalid"], { cwd: snapshot }); await run("git", ["add", "-A"], { cwd: snapshot }); await run("git", ["commit", "-qm", "benchmark snapshot"], { cwd: snapshot })
  const snapshotCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: snapshot })).stdout.trim(); pluginSpec = `git+${pathToFileURL(snapshot).href}`
  await run("opencode", ["plugin", "add", pluginSpec], { timeoutMs: 90_000 })
  const deadline = Date.now() + 20_000; while (Date.now() < deadline) { const listed = await run("opencode", ["plugin", "list"], { timeoutMs: 10_000 }); if (/^rlm\s/m.test(listed.stdout)) break; await new Promise((r) => setTimeout(r, 250)) }
  const endpoint = await discover(); if (!endpoint) throw new Error("OpenCode service unavailable")
  await fs.mkdir(path.join(workspace, "src"), { recursive: true }); for (const name of await fs.readdir(path.join(corpusRoot, "src"))) await fs.copyFile(path.join(corpusRoot, "src", name), path.join(workspace, "src", name))
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "This is a benchmark corpus. Follow the user prompt exactly. Do not use ordinary subagents or network tools.\n")
  const truthJson = JSON.parse(await fs.readFile(groundTruthFile, "utf8")); const truth = truthJson.cases.filter((x) => x.class === "violation").map((x) => x.path).sort()
  const runs = [], failures = []
  for (let round = 0; round < orders.length; round++) for (let position = 0; position < 1; position++) {
    const arm = orders[round][position]; await setChildPolicy(configFile, baseConfig, arm)
    let result
    for (let attempt = 1; attempt <= 4; attempt++) { try { result = await runArm(endpoint, workspace, arm); break } catch (error) { failures.push({ round: round + 1, position: position + 1, arm, attempt, error: String(error) }); console.log(`RETRY round=${round+1} arm=${arm} attempt=${attempt} ${String(error).slice(0,400)}`); if (attempt === 4) throw error } }
    result.round = round + 1; result.position = position + 1; result.quality = score(result.predicted_violations, truth)
    if (result.child_session_count !== fanout) throw new Error(`${arm}: expected ${fanout} children, got ${result.child_session_count}`)
    if (result.child_models.length !== 1 || result.child_models[0] !== "openai/gpt-6-sol#low") throw new Error(`${arm}: expected inherited Sol children, got ${JSON.stringify(result.child_models)}`)
    runs.push(result); console.log(`ROUND${round+1} ${arm} f1=${result.quality.f1.toFixed(4)} p=${result.quality.precision.toFixed(4)} r=${result.quality.recall.toFixed(4)} fp=${result.quality.fp} fn=${result.quality.fn} root=${result.token_accounting.root_logical_tokens} child=${result.token_accounting.child_logical_tokens} total=${result.token_accounting.total_logical_tokens} wall=${result.wall_ms} candidates=${result.candidate_count}`)
  }
  const summary = Object.fromEntries(arms.map((arm) => [arm, summarize(runs, arm)]))
  const report = { benchmark_id: "semantic-state-audit-v3-384-root-verification-conservative", root_model: "openai/gpt-6-sol#low", child_model: "openai/gpt-6-sol#low", fanout, concurrency_ceiling: 4, snapshot_commit: snapshotCommit, orders, runs, failures, summary, caveats: ["Verification can remove false positives but cannot recover candidates missed by the first-stage scan.", "The verify arm receives full source only for first-stage candidates and is forbidden from using additional root tools.", "Logical token counts include cache-read tokens.", "Three runs per arm reduce but do not eliminate model variance."] }
  await fs.mkdir(outDir, { recursive: true }); await fs.writeFile(path.join(outDir, "conservative-verification.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(`MEDIANS ${JSON.stringify(Object.fromEntries(arms.map((arm) => [arm, { f1: summary[arm].f1.median, precision: summary[arm].precision.median, recall: summary[arm].recall.median, root: summary[arm].root_logical_tokens.median, child: summary[arm].child_logical_tokens.median, total: summary[arm].total_logical_tokens.median, wall: summary[arm].wall_ms.median, candidates: arm === "verify" ? median(runs.filter((x) => x.arm === arm).map((x) => x.candidate_count)) : 0 }])) )}`)
} finally {
  const endpoint = await discover().catch(() => undefined); if (endpoint) for (const id of createdSessions) await api(endpoint, `/api/session/${id}`, { method: "DELETE" }).catch(() => {})
  if (pluginSpec) await run("opencode", ["plugin", "remove", pluginSpec], { timeoutMs: 30_000 }).catch(() => {})
  if (originalConfig) await fs.writeFile(configFile, originalConfig); else await fs.rm(configFile, { force: true }).catch(() => {})
  await fs.rm(tempRoot, { recursive: true, force: true })
}
