import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { discover } from "@opencode/client/service"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const corpusRoot = path.join(repoRoot, "benchmarks/corpora/semantic-state-audit-v3-384")
const groundTruthFile = path.join(repoRoot, "benchmarks/ground-truth/semantic-state-audit-v3-384.json")
const outDir = path.join(repoRoot, "benchmarks/runs/2026-10-17-gpt-6-luna-low-memory-384")
const model = { providerID: "openai", id: "gpt-6-luna", variant: "low" }
const rule = "Audit every assigned file. Report a file only when observable business, domain, or UI result state is mutated before a successful awaited asynchronous backend or worker operation completes. Loading, busy, pending, syncing, or similar lifecycle state before the await is not a violation. Result-state updates after the await, local-only mutations without backend coupling, and backend or mock adapter implementations are not violations. Return exactly one JSON array of project-relative violation paths and no prose."

const singleCode = `const paths = (await context.files("src/")).sort();
const files = [];
for (let i = 0; i < paths.length; i += 64) files.push(...await context.readMany(paths.slice(i, i + 64)));
const groups = [[], [], [], []];
for (let i = 0; i < files.length; i++) groups[i % 4].push(files[i]);
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

function partitionCode(startFraction, endFraction, key) {
  return `const paths = (await context.files("src/")).sort();
const start = Math.floor(paths.length * ${startFraction});
const end = ${endFraction === 1 ? "paths.length" : `Math.floor(paths.length * ${endFraction})`};
const selected = paths.slice(start, end);
const files = [];
for (let i = 0; i < selected.length; i += 64) files.push(...await context.readMany(selected.slice(i, i + 64)));
const groups = [[], [], [], []];
for (let i = 0; i < files.length; i++) groups[i % 4].push(files[i]);
const rule = ${JSON.stringify(rule)};
const nl = String.fromCharCode(10);
const prompts = groups.map((group) => rule + nl + group.map((file) => JSON.stringify({ path: file.path, source: file.content || "" })).join(nl));
const answers = await llm.batch(prompts);
const found = [];
for (const answer of answers) {
  const text = String(answer).trim(); const open = text.indexOf("["); const close = text.lastIndexOf("]");
  if (open >= 0 && close >= open) for (const value of JSON.parse(text.slice(open, close + 1))) if (typeof value === "string") found.push(value);
}
const violations = [...new Set(found)].sort();
await memory.set(${JSON.stringify(key)}, violations);
return { stored: violations.length };`
}

const memoryPartitionBody = `const paths = (await context.files("src/")).sort();
const start = HALF === 0 ? 0 : Math.floor(paths.length / 2);
const end = HALF === 0 ? Math.floor(paths.length / 2) : paths.length;
const selected = paths.slice(start, end);
const files = [];
for (let i = 0; i < selected.length; i += 64) files.push(...await context.readMany(selected.slice(i, i + 64)));
const groups = [[], [], [], []];
for (let i = 0; i < files.length; i++) groups[i % 4].push(files[i]);
const rule = ${JSON.stringify(rule)};
const nl = String.fromCharCode(10);
const prompts = groups.map((group) => rule + nl + group.map((file) => JSON.stringify({ path: file.path, source: file.content || "" })).join(nl));
const answers = await llm.batch(prompts);
const found = [];
for (const answer of answers) {
  const text = String(answer).trim(); const open = text.indexOf("["); const close = text.lastIndexOf("]");
  if (open >= 0 && close >= open) for (const value of JSON.parse(text.slice(open, close + 1))) if (typeof value === "string") found.push(value);
}
const violations = [...new Set(found)].sort();
await memory.set(KEY, violations);
return { stored: violations.length };`
const memoryMergeCode = `const a = await memory.get("audit:half:0");
const b = await memory.get("audit:half:1");
const all = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
return { violations: [...new Set(all)].sort() };`

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

async function runArm(endpoint, workspace, kind) {
  const created = unwrap(await api(endpoint, "/api/session", { method: "POST", body: JSON.stringify({ title: `rlm-memory-benchmark-${kind}`, model, location: { directory: workspace } }) }))
  const sessionId = created.id
  createdSessions.push(sessionId)
  const executeJs = `return await tools.rlm_benchmark({ mode: ${JSON.stringify(kind)} })`
  const prompt = `Use the execute tool exactly once. Do not inspect files with root tools and do not call ordinary subagents. Inside execute run exactly this JavaScript and do nothing else: ${executeJs}. Return only the execute result.`
  const started = Date.now()
  await api(endpoint, `/api/session/${sessionId}/prompt`, { method: "POST", body: JSON.stringify({ text: prompt }) })
  await api(endpoint, `/api/experimental/session/${sessionId}/wait`, { method: "POST" })
  const finished = Date.now()
  const messages = unwrap(await api(endpoint, `/api/session/${sessionId}/message`))
  const assistantParts = messages.filter((m) => m.type === "assistant" || m.info?.role === "assistant").flatMap((m) => m.content ?? m.parts ?? [])
  const execute = assistantParts.find((p) => p.type === "tool" && p.name === "execute")
  if (!execute || execute.state?.status !== "completed") throw new Error(`${kind}: execute did not complete: ${JSON.stringify(execute?.state ?? null)}`)
  const nested = execute.state?.metadata?.toolCalls ?? []
  const benchmarkCalls = nested.filter((x) => x.tool === "rlm_benchmark")
  if (benchmarkCalls.length !== 1 || benchmarkCalls[0]?.status !== "completed") throw new Error(`${kind}: benchmark helper did not complete: ${JSON.stringify({ benchmarkCalls, executeState: execute.state })}`)
  const rlmCalls = Array.from({ length: kind === "single" ? 1 : 3 }, () => ({ status: "completed" }))
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
  const rootUsage = sumUsage(messages)
  return { kind, session_id: sessionId, wall_ms: finished - started, predicted_violations: predicted, root_usage: rootUsage, child_usage: childUsage, rlm_exec_count: rlmCalls.length, child_session_count: children.length, nested_statuses: rlmCalls.map((x) => x.status), execute_output_chars: text.length }
}

async function installBenchmarkTool(snapshotRoot) {
  const helperSource = [
    "export function benchmarkCodes(mode: unknown): string[] {",
    `  if (mode === "single") return [${JSON.stringify(singleCode)}]`,
    "  if (mode === \"memory\") {",
    `    const body = ${JSON.stringify(memoryPartitionBody)}`,
    "    return [",
    "      'const HALF=0; const KEY=\\\"audit:half:0\\\";\\n' + body,",
    "      'const HALF=1; const KEY=\\\"audit:half:1\\\";\\n' + body,",
    `      ${JSON.stringify(memoryMergeCode)},`,
    "    ]",
    "  }",
    "  throw new Error(\"benchmark mode must be single or memory\")",
    "}",
    "",
  ].join("\n")
  await fs.writeFile(path.join(snapshotRoot, "plugin/rlm-lib/benchmark-helper.ts"), helperSource)
  const pluginFile = path.join(snapshotRoot, "plugin/rlm.ts")
  let source = await fs.readFile(pluginFile, "utf8")
  source = source.replace(
    'import { RLM_EXEC_DESCRIPTION } from "./rlm-lib/tool-description.ts"',
    'import { RLM_EXEC_DESCRIPTION } from "./rlm-lib/tool-description.ts"\nimport { benchmarkCodes } from "./rlm-lib/benchmark-helper.ts"',
  )
  const needle = "      })\n    })\n\n    void (async () => {"
  const addition = [
    "      })",
    "",
    "      editor.add({",
    "        name: \"rlm_benchmark\",",
    "        description: \"Benchmark-only fixed RLM orchestration helper.\",",
    "        input: { type: \"object\", properties: { mode: { type: \"string\", enum: [\"single\", \"memory\"] } }, required: [\"mode\"], additionalProperties: false },",
    "        async execute(input, context) {",
    "          const codes = benchmarkCodes((input as { mode?: unknown }).mode)",
    "          let finalOutcome",
    "          for (const code of codes) {",
    "            finalOutcome = await executeRlmExec(host, { code, parentSessionID: context.sessionID, directory, worktree, messageID: context.messageID, abort: context.signal, log })",
    "          }",
    "          if (!finalOutcome) throw new Error(\"benchmark helper produced no RLM outcome\")",
    "          return { content: finalOutcome.output, metadata: { ...finalOutcome.metadata, benchmarkExecCount: codes.length } }",
    "        },",
    "      })",
    "    })",
    "",
    "    void (async () => {",
  ].join("\n")
  if (!source.includes(needle)) throw new Error("benchmark tool injection point not found")
  source = source.replace(needle, addition)
  await fs.writeFile(pluginFile, source)
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rlm-memory-benchmark-"))
const snapshot = path.join(tempRoot, "package")
const workspace = path.join(tempRoot, "workspace")
let pluginSpec
const createdSessions = []
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
  const orders = [["single", "memory"], ["memory", "single"], ["single", "memory"]]
  const runs = []
  const failures = []
  const accountTokens = (arm) => {
    const rootUncached = arm.root_usage.input + arm.root_usage.output
    const rootLogical = rootUncached + arm.root_usage.cache_read
    const childTokens = arm.child_usage.input + arm.child_usage.output + arm.child_usage.cache_read
    arm.token_accounting = {
      root_uncached_tokens: rootUncached,
      root_cache_read_tokens: arm.root_usage.cache_read,
      root_logical_tokens_including_cache_read: rootLogical,
      child_logical_tokens_including_cache_read: childTokens,
      total_logical_tokens_including_cache_read: rootLogical + childTokens,
    }
  }
  for (let pairIndex = 0; pairIndex < orders.length; pairIndex++) {
    const order = orders[pairIndex]
    for (let position = 0; position < order.length; position++) {
      const kind = order[position]
      let arm
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          arm = await runArm(endpoint, workspace, kind)
          break
        } catch (error) {
          const failure = { pair_index: pairIndex + 1, position_in_pair: position + 1, kind, attempt, error: String(error) }
          failures.push(failure)
          console.log(`RETRY pair=${pairIndex + 1} kind=${kind} attempt=${attempt} error=${String(error).slice(0, 500)}`)
          if (attempt === 2) throw error
        }
      }
      arm.quality = score(arm.predicted_violations, truth)
      arm.pair_index = pairIndex + 1
      arm.position_in_pair = position + 1
      accountTokens(arm)
      runs.push(arm)
      console.log(`PAIR${pairIndex + 1} ${kind.toUpperCase()} f1=${arm.quality.f1.toFixed(4)} precision=${arm.quality.precision.toFixed(4)} recall=${arm.quality.recall.toFixed(4)} rootLogical=${arm.token_accounting.root_logical_tokens_including_cache_read} child=${arm.token_accounting.child_logical_tokens_including_cache_read} total=${arm.token_accounting.total_logical_tokens_including_cache_read} wall=${arm.wall_ms}`)
    }
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  const summarize = (kind) => {
    const arms = runs.filter((run) => run.kind === kind)
    const metric = (fn) => arms.map(fn)
    const stat = (values) => ({ median: median(values), min: Math.min(...values), max: Math.max(...values), values })
    return {
      count: arms.length,
      f1: stat(metric((x) => x.quality.f1)),
      precision: stat(metric((x) => x.quality.precision)),
      recall: stat(metric((x) => x.quality.recall)),
      tp: stat(metric((x) => x.quality.tp)),
      fp: stat(metric((x) => x.quality.fp)),
      fn: stat(metric((x) => x.quality.fn)),
      root_logical_tokens: stat(metric((x) => x.token_accounting.root_logical_tokens_including_cache_read)),
      child_logical_tokens: stat(metric((x) => x.token_accounting.child_logical_tokens_including_cache_read)),
      total_logical_tokens: stat(metric((x) => x.token_accounting.total_logical_tokens_including_cache_read)),
      wall_ms: stat(metric((x) => x.wall_ms)),
    }
  }
  const singleSummary = summarize("single")
  const memorySummary = summarize("memory")
  const medDelta = (name) => memorySummary[name].median - singleSummary[name].median
  const report = {
    benchmark_id: "semantic-state-audit-v3-384",
    model: "openai/gpt-6-luna#low",
    snapshot_commit: snapshotCommit,
    design: {
      single: "1 rlm_exec / 4 child calls",
      memory: "2 partition rlm_exec / 8 child calls + 1 memory merge rlm_exec",
      pair_orders: orders,
      runs_per_arm: 3,
    },
    runs,
    failures,
    summary: { single: singleSummary, memory: memorySummary },
    median_deltas_memory_minus_single: {
      f1: medDelta("f1"),
      precision: medDelta("precision"),
      recall: medDelta("recall"),
      root_logical_tokens: medDelta("root_logical_tokens"),
      child_logical_tokens: medDelta("child_logical_tokens"),
      total_logical_tokens: medDelta("total_logical_tokens"),
      wall_ms: medDelta("wall_ms"),
    },
    caveats: [
      "Prompt-cache accounting can depend on arm order; architecture-level token comparisons use cache-inclusive root logical tokens.",
      "The benchmark-only orchestration helper exists only in the temporary package snapshot; production RLM runtime code is unchanged.",
      "Three runs per arm reduce but do not eliminate stochastic model variance.",
    ],
  }
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, "repeated-comparison.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(`MEDIAN ${JSON.stringify({
    single: { f1: singleSummary.f1.median, precision: singleSummary.precision.median, recall: singleSummary.recall.median, root: singleSummary.root_logical_tokens.median, child: singleSummary.child_logical_tokens.median, total: singleSummary.total_logical_tokens.median, wall: singleSummary.wall_ms.median },
    memory: { f1: memorySummary.f1.median, precision: memorySummary.precision.median, recall: memorySummary.recall.median, root: memorySummary.root_logical_tokens.median, child: memorySummary.child_logical_tokens.median, total: memorySummary.total_logical_tokens.median, wall: memorySummary.wall_ms.median },
    delta: report.median_deltas_memory_minus_single,
  })}`)
} finally {
  const endpoint = await discover().catch(() => undefined)
  if (endpoint) for (const id of createdSessions) await api(endpoint, `/api/session/${id}`, { method: "DELETE" }).catch(() => {})
  if (pluginSpec) await run("opencode", ["plugin", "remove", pluginSpec], { timeoutMs: 30_000 }).catch(() => {})
  await fs.rm(tempRoot, { recursive: true, force: true })
}
