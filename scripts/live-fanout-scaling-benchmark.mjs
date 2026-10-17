import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { discover } from "@opencode/client/service"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const corpusRoot = path.join(repoRoot, "benchmarks/corpora/semantic-state-audit-v3-384")
const groundTruthFile = path.join(repoRoot, "benchmarks/ground-truth/semantic-state-audit-v3-384.json")
const outDir = path.join(repoRoot, "benchmarks/runs/2026-10-17-gpt-6-luna-low-fanout-384")
const model = { providerID: "openai", id: "gpt-6-luna", variant: "low" }
const fanouts = [4, 8, 16]
const orders = [[4, 8, 16], [8, 16, 4], [16, 4, 8]]
const rule = "Audit every assigned file. Report a file only when observable business, domain, or UI result state is mutated before a successful awaited asynchronous backend or worker operation completes. Loading, busy, pending, syncing, or similar lifecycle state before the await is not a violation. Result-state updates after the await, local-only mutations without backend coupling, and backend or mock adapter implementations are not violations. Return exactly one JSON array of project-relative violation paths and no prose."

function fanoutCode(fanout) {
  return `const paths = (await context.files("src/")).sort();\nconst files = [];\nfor (let i = 0; i < paths.length; i += 64) files.push(...await context.readMany(paths.slice(i, i + 64)));\nconst groups = Array.from({ length: ${fanout} }, () => []);\nfor (let i = 0; i < files.length; i++) groups[i % ${fanout}].push(files[i]);\nconst rule = ${JSON.stringify(rule)};\nconst nl = String.fromCharCode(10);\nconst prompts = groups.map((group) => rule + nl + group.map((file) => JSON.stringify({ path: file.path, source: file.content || "" })).join(nl));\nconst answers = await llm.batch(prompts);\nconst found = [];\nfor (const answer of answers) {\n  const text = String(answer).trim(); const start = text.indexOf("["); const end = text.lastIndexOf("]");\n  if (start >= 0 && end >= start) for (const value of JSON.parse(text.slice(start, end + 1))) if (typeof value === "string") found.push(value);\n}\nreturn { violations: [...new Set(found)].sort() };`
}

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
function assistantInfo(message) { return message?.info ?? message }
function sumUsage(messages) {
  const out = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost_usd: 0 }
  for (const message of messages) {
    if (message.type !== "assistant" && message.info?.role !== "assistant") continue
    const info = assistantInfo(message); const t = info.tokens ?? message.tokens ?? {}
    out.input += Number(t.input ?? 0); out.output += Number(t.output ?? 0); out.reasoning += Number(t.reasoning ?? 0)
    out.cache_read += Number(t.cache?.read ?? 0); out.cache_write += Number(t.cache?.write ?? 0); out.cost_usd += Number(info.cost ?? message.cost ?? 0)
  }
  return out
}
function parseToolText(text) {
  let value = String(text).trim()
  for (let i = 0; i < 3; i++) {
    try { const parsed = JSON.parse(value); if (typeof parsed === "string") { value = parsed; continue } return parsed } catch {}
    const start = value.indexOf("{"); const end = value.lastIndexOf("}")
    if (start >= 0 && end > start) { value = value.slice(start, end + 1); continue }
    break
  }
  throw new Error(`Could not parse tool result: ${value.slice(0, 500)}`)
}
function score(predicted, truth) {
  const p = new Set(predicted), t = new Set(truth)
  let tp = 0, fp = 0, fn = 0
  for (const x of p) t.has(x) ? tp++ : fp++
  for (const x of t) if (!p.has(x)) fn++
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  return { tp, fp, fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 }
}
function accountTokens(arm) {
  const rootLogical = arm.root_usage.input + arm.root_usage.output + arm.root_usage.cache_read
  const childLogical = arm.child_usage.input + arm.child_usage.output + arm.child_usage.cache_read
  arm.token_accounting = {
    root_logical_tokens: rootLogical,
    child_logical_tokens: childLogical,
    total_logical_tokens: rootLogical + childLogical,
    root_cache_read_tokens: arm.root_usage.cache_read,
    child_cache_read_tokens: arm.child_usage.cache_read,
  }
}

const createdSessions = []
async function runArm(endpoint, workspace, fanout) {
  const created = unwrap(await api(endpoint, "/api/session", { method: "POST", body: JSON.stringify({ title: `rlm-fanout-${fanout}`, model, location: { directory: workspace } }) }))
  const sessionId = created.id
  createdSessions.push(sessionId)
  const executeJs = `return await tools.rlm_benchmark({ fanout: ${fanout} })`
  const prompt = `Use the execute tool exactly once. Do not inspect files with root tools and do not call ordinary subagents. Inside execute run exactly this JavaScript and do nothing else: ${executeJs}. Return only the execute result.`
  const started = Date.now()
  await api(endpoint, `/api/session/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ text: prompt }) })
  await api(endpoint, `/api/experimental/session/${sessionId}/wait`, { method: "POST" })
  const finished = Date.now()
  const messages = unwrap(await api(endpoint, `/api/session/${sessionId}/message`))
  const assistantParts = messages.filter((m) => m.type === "assistant" || m.info?.role === "assistant").flatMap((m) => m.content ?? m.parts ?? [])
  const execute = assistantParts.find((p) => p.type === "tool" && p.name === "execute")
  if (!execute || execute.state?.status !== "completed") throw new Error(`fanout=${fanout}: execute did not complete: ${JSON.stringify(execute?.state ?? null)}`)
  const nested = execute.state?.metadata?.toolCalls ?? []
  const benchmarkCalls = nested.filter((x) => x.tool === "rlm_benchmark")
  if (benchmarkCalls.length !== 1 || benchmarkCalls[0]?.status !== "completed") throw new Error(`fanout=${fanout}: benchmark helper did not complete: ${JSON.stringify({ benchmarkCalls, executeState: execute.state })}`)
  const text = (execute.state?.content ?? []).filter((x) => x.type === "text").map((x) => x.text).join("\n")
  const parsed = parseToolText(text)
  const predicted = [...new Set((parsed.violations ?? []).filter((x) => typeof x === "string"))].sort()
  const sessions = unwrap(await api(endpoint, "/api/session"))
  const children = sessions.filter((s) => s.parentID === sessionId)
  let childUsage = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost_usd: 0 }
  for (const child of children) {
    const childMessages = unwrap(await api(endpoint, `/api/session/${child.id}/message`))
    const u = sumUsage(childMessages)
    for (const key of Object.keys(childUsage)) childUsage[key] += u[key]
  }
  const metadata = benchmarkCalls[0]?.metadata ?? benchmarkCalls[0]?.state?.metadata ?? {}
  const arm = {
    fanout,
    session_id: sessionId,
    wall_ms: finished - started,
    predicted_violations: predicted,
    root_usage: sumUsage(messages),
    child_usage: childUsage,
    child_session_count: children.length,
    runtime_metadata: {
      childCallCount: metadata.childCallCount,
      maxChildConcurrencyObserved: metadata.maxChildConcurrencyObserved,
    },
  }
  accountTokens(arm)
  return arm
}

async function installBenchmarkTool(snapshotRoot) {
  const cases = fanouts.map((n) => `  if (fanout === ${n}) return ${JSON.stringify(fanoutCode(n))}`).join("\n")
  const helperSource = `export function benchmarkCode(fanout: unknown): string {\n${cases}\n  throw new Error("fanout must be 4, 8, or 16")\n}\n`
  await fs.writeFile(path.join(snapshotRoot, "plugin/rlm-lib/benchmark-helper.ts"), helperSource)
  const pluginFile = path.join(snapshotRoot, "plugin/rlm.ts")
  let source = await fs.readFile(pluginFile, "utf8")
  source = source.replace(
    'import { RLM_EXEC_DESCRIPTION } from "./rlm-lib/tool-description.ts"',
    'import { RLM_EXEC_DESCRIPTION } from "./rlm-lib/tool-description.ts"\nimport { benchmarkCode } from "./rlm-lib/benchmark-helper.ts"',
  )
  const needle = "      })\n    })\n\n    void (async () => {"
  const addition = [
    "      })",
    "",
    "      editor.add({",
    "        name: \"rlm_benchmark\",",
    "        description: \"Benchmark-only fixed fan-out orchestration helper.\",",
    "        input: { type: \"object\", properties: { fanout: { type: \"number\", enum: [4, 8, 16] } }, required: [\"fanout\"], additionalProperties: false },",
    "        async execute(input, context) {",
    "          const code = benchmarkCode((input as { fanout?: unknown }).fanout)",
    "          const outcome = await executeRlmExec(host, { code, parentSessionID: context.sessionID, directory, worktree, messageID: context.messageID, abort: context.signal, log })",
    "          return { content: outcome.output, metadata: outcome.metadata }",
    "        },",
    "      })",
    "    })",
    "",
    "    void (async () => {",
  ].join("\n")
  if (!source.includes(needle)) throw new Error("benchmark tool injection point not found")
  await fs.writeFile(pluginFile, source.replace(needle, addition))
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
function summarize(runs, fanout) {
  const arms = runs.filter((run) => run.fanout === fanout)
  const stat = (values) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values), values })
  return {
    count: arms.length,
    f1: stat(arms.map((x) => x.quality.f1)),
    precision: stat(arms.map((x) => x.quality.precision)),
    recall: stat(arms.map((x) => x.quality.recall)),
    tp: stat(arms.map((x) => x.quality.tp)),
    fp: stat(arms.map((x) => x.quality.fp)),
    fn: stat(arms.map((x) => x.quality.fn)),
    root_logical_tokens: stat(arms.map((x) => x.token_accounting.root_logical_tokens)),
    child_logical_tokens: stat(arms.map((x) => x.token_accounting.child_logical_tokens)),
    total_logical_tokens: stat(arms.map((x) => x.token_accounting.total_logical_tokens)),
    wall_ms: stat(arms.map((x) => x.wall_ms)),
    child_session_count: stat(arms.map((x) => x.child_session_count)),
  }
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rlm-fanout-benchmark-"))
const snapshot = path.join(tempRoot, "package")
const workspace = path.join(tempRoot, "workspace")
let pluginSpec
try {
  await fs.cp(repoRoot, snapshot, { recursive: true, filter(source) { const rel = path.relative(repoRoot, source); if (!rel) return true; return !new Set([".git", "node_modules", ".opencode", ".tmp", "coverage"]).has(rel.split(path.sep)[0]) } })
  await installBenchmarkTool(snapshot)
  await run("git", ["init", "-q"], { cwd: snapshot }); await run("git", ["config", "user.name", "RLM Benchmark"], { cwd: snapshot }); await run("git", ["config", "user.email", "benchmark@example.invalid"], { cwd: snapshot }); await run("git", ["add", "-A"], { cwd: snapshot }); await run("git", ["commit", "-qm", "benchmark snapshot"], { cwd: snapshot })
  const snapshotCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: snapshot })).stdout.trim()
  pluginSpec = `git+${pathToFileURL(snapshot).href}`
  await run("opencode", ["plugin", "add", pluginSpec], { timeoutMs: 90_000 })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) { const listed = await run("opencode", ["plugin", "list"], { timeoutMs: 10_000 }); if (/^rlm\s/m.test(listed.stdout)) break; await new Promise((r) => setTimeout(r, 250)) }
  let endpoint = await discover(); if (!endpoint) { await run("opencode", ["service", "start"]); endpoint = await discover() }
  if (!endpoint) throw new Error("OpenCode service unavailable")
  await fs.mkdir(path.join(workspace, "src"), { recursive: true })
  for (const name of await fs.readdir(path.join(corpusRoot, "src"))) await fs.copyFile(path.join(corpusRoot, "src", name), path.join(workspace, "src", name))
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "This is a benchmark corpus. Follow the user prompt exactly. Do not use ordinary subagents or network tools. When the user supplies exact Code Mode JavaScript, execute it exactly once and return only its result.\n")
  const truthJson = JSON.parse(await fs.readFile(groundTruthFile, "utf8")); const truth = truthJson.cases.filter((x) => x.class === "violation").map((x) => x.path).sort()
  const runs = [], failures = []
  for (let round = 0; round < orders.length; round++) {
    for (let position = 0; position < orders[round].length; position++) {
      const fanout = orders[round][position]
      let arm
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { arm = await runArm(endpoint, workspace, fanout); break }
        catch (error) {
          failures.push({ round: round + 1, position: position + 1, fanout, attempt, error: String(error) })
          console.log(`RETRY round=${round + 1} fanout=${fanout} attempt=${attempt} error=${String(error).slice(0, 400)}`)
          if (attempt === 2) throw error
        }
      }
      arm.round = round + 1; arm.position = position + 1; arm.quality = score(arm.predicted_violations, truth)
      if (arm.child_session_count !== fanout) throw new Error(`fanout=${fanout}: expected ${fanout} child sessions, got ${arm.child_session_count}`)
      runs.push(arm)
      console.log(`ROUND${round + 1} F${fanout} f1=${arm.quality.f1.toFixed(4)} p=${arm.quality.precision.toFixed(4)} r=${arm.quality.recall.toFixed(4)} root=${arm.token_accounting.root_logical_tokens} child=${arm.token_accounting.child_logical_tokens} total=${arm.token_accounting.total_logical_tokens} wall=${arm.wall_ms} children=${arm.child_session_count}`)
    }
  }
  const summary = Object.fromEntries(fanouts.map((n) => [String(n), summarize(runs, n)]))
  const report = {
    benchmark_id: "semantic-state-audit-v3-384-fanout-scaling",
    model: "openai/gpt-6-luna#low",
    snapshot_commit: snapshotCommit,
    design: { fanouts, concurrency_ceiling: 4, orders, runs_per_fanout: 3, one_rlm_exec_per_run: true },
    runs, failures, summary,
    caveats: [
      "Fixed benchmark-only orchestration isolates fan-out from generated-JavaScript reliability.",
      "Logical token accounting includes cache-read tokens for both root and child sessions.",
      "Three runs per fan-out reduce but do not eliminate stochastic model variance.",
      "The corpus is about 75 KiB of TypeScript and should not be generalized to huge-context workloads.",
    ],
  }
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, "scaling.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(`MEDIANS ${JSON.stringify(Object.fromEntries(fanouts.map((n) => [n, { f1: summary[n].f1.median, precision: summary[n].precision.median, recall: summary[n].recall.median, root: summary[n].root_logical_tokens.median, child: summary[n].child_logical_tokens.median, total: summary[n].total_logical_tokens.median, wall: summary[n].wall_ms.median }])) )}`)
} finally {
  const endpoint = await discover().catch(() => undefined)
  if (endpoint) for (const id of createdSessions) await api(endpoint, `/api/session/${id}`, { method: "DELETE" }).catch(() => {})
  if (pluginSpec) await run("opencode", ["plugin", "remove", pluginSpec], { timeoutMs: 30_000 }).catch(() => {})
  await fs.rm(tempRoot, { recursive: true, force: true })
}
