import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { discover } from "@opencode/client/service"
import { captureOpenCodeSessionTree } from "./lib/opencode-evidence.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const modelSpec = process.env.RLM_LIVE_OPENCODE_MODEL?.trim()
if (!modelSpec) throw new Error("RLM_LIVE_OPENCODE_MODEL is required, for example ollama-cloud/deepseek-v4.1-flash")

function parseModel(spec) {
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) throw new Error(`invalid model spec: ${spec}`)
  const providerID = spec.slice(0, slash)
  const rawModel = spec.slice(slash + 1)
  const hash = rawModel.lastIndexOf("#")
  return hash < 0
    ? { providerID, id: rawModel }
    : { providerID, id: rawModel.slice(0, hash), variant: rawModel.slice(hash + 1) }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = "", stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`${command} timed out after ${options.timeoutMs ?? 60_000}ms`))
    }, options.timeoutMs ?? 60_000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    child.on("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} ${args.join(" ")} failed\n${stdout}\n${stderr}`))
    })
  })
}

async function api(endpoint, route, init = {}) {
  const headers = { "content-type": "application/json" }
  if (endpoint.auth?.type === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${endpoint.auth.username}:${endpoint.auth.password}`).toString("base64")}`
  }
  const response = await fetch(endpoint.url + route, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${route}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? null : response.json()
}

const unwrap = (value) => value?.data ?? value

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
  throw new Error(`could not parse JSON value: ${value.slice(0, 600)}`)
}

function decodeNested(value) {
  return typeof value === "string" ? parseJsonish(value) : value
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rlm-verify-smoke-"))
const snapshot = path.join(tempRoot, "package")
const workspace = path.join(tempRoot, "workspace")
let pluginSpec
let endpoint
let rootSessionID
let serviceStartedHere = false

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
  await run("git", ["config", "user.name", "RLM Verify Smoke"], { cwd: snapshot })
  await run("git", ["config", "user.email", "rlm-smoke@example.invalid"], { cwd: snapshot })
  await run("git", ["add", "-A"], { cwd: snapshot })
  await run("git", ["commit", "-qm", "verify smoke snapshot"], { cwd: snapshot })

  pluginSpec = `git+${pathToFileURL(snapshot).href}`
  await run("opencode", ["plugin", "add", pluginSpec], { timeoutMs: 90_000 })
  const pluginDeadline = Date.now() + 20_000
  while (Date.now() < pluginDeadline) {
    const listed = await run("opencode", ["plugin", "list"], { timeoutMs: 10_000 })
    if (/^rlm\s/m.test(listed.stdout)) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  endpoint = await discover()
  if (!endpoint) {
    await run("opencode", ["service", "start"], { timeoutMs: 30_000 })
    serviceStartedHere = true
    endpoint = await discover()
  }
  if (!endpoint) throw new Error("OpenCode service unavailable")

  await fs.mkdir(path.join(workspace, "src"), { recursive: true })
  await fs.writeFile(path.join(workspace, "src/a.ts"), "// REVIEW_CANDIDATE\nexport const result = 'VIOLATION'\n")
  await fs.writeFile(path.join(workspace, "src/b.ts"), "// REVIEW_CANDIDATE\nexport const result = 'SAFE_EXCEPTION'\n")
  await fs.writeFile(path.join(workspace, "src/c.ts"), "export const ordinary = 'ignore me'\n")
  await fs.writeFile(path.join(workspace, "src/d.ts"), "// REVIEW_CANDIDATE\nexport const other = 'VIOLATION'\n")

  const model = parseModel(modelSpec)
  const created = unwrap(await api(endpoint, "/api/session", {
    method: "POST",
    body: JSON.stringify({ title: "rlm-structured-verify-live-smoke", model, location: { directory: workspace } }),
  }))
  rootSessionID = created.id

  const mapInput = {
    query: "src/",
    instruction: "Return exactly one JSON array containing only project-relative paths whose source contains the literal REVIEW_CANDIDATE. Return no prose.",
    fanout: 2,
    output: "path_list",
    partition: "balanced_chars",
    failureMode: "strict",
  }
  const verifyInstruction = "A candidate remains valid when its source contains the literal VIOLATION. The literal SAFE_EXCEPTION clearly proves an allowed exception and the candidate should be removed. If the source does not clearly prove an exception, keep the candidate."
  const executeJs = [
    `const mappedRaw = await tools.rlm_map(${JSON.stringify(mapInput)})`,
    `const mapped = typeof mappedRaw === "string" ? JSON.parse(mappedRaw) : mappedRaw`,
    `const verifiedRaw = await tools.rlm_verify({ candidates: mapped.paths, instruction: ${JSON.stringify(verifyInstruction)}, fanout: 2, partition: "round_robin", failureMode: "strict" })`,
    `const verified = typeof verifiedRaw === "string" ? JSON.parse(verifiedRaw) : verifiedRaw`,
    "return { mapped, verified }",
  ].join("; ")
  const prompt = `Use the execute tool exactly once. Inside it run exactly this JavaScript and nothing else: ${executeJs}. Return only the execute result.`

  await api(endpoint, `/api/session/${rootSessionID}/prompt`, { method: "POST", body: JSON.stringify({ text: prompt }) })
  await api(endpoint, `/api/experimental/session/${rootSessionID}/wait`, { method: "POST" })

  const rootMessages = unwrap(await api(endpoint, `/api/session/${rootSessionID}/message`))
  const assistantParts = rootMessages
    .filter((message) => message.type === "assistant" || message.info?.role === "assistant")
    .flatMap((message) => message.content ?? message.parts ?? [])
  const executeCalls = assistantParts.filter((part) => part.type === "tool" && part.name === "execute")
  if (executeCalls.length !== 1 || executeCalls[0].state?.status !== "completed") {
    throw new Error(`expected one completed execute call: ${JSON.stringify(executeCalls.map((part) => part.state?.status))}`)
  }
  const execute = executeCalls[0]
  const nestedCalls = execute.state?.metadata?.toolCalls ?? []
  const mapCalls = nestedCalls.filter((call) => call.tool === "rlm_map")
  const verifyCalls = nestedCalls.filter((call) => call.tool === "rlm_verify")
  if (mapCalls.length !== 1 || mapCalls[0].status !== "completed") throw new Error(`expected one completed rlm_map: ${JSON.stringify(mapCalls)}`)
  if (verifyCalls.length !== 1 || verifyCalls[0].status !== "completed") throw new Error(`expected one completed rlm_verify: ${JSON.stringify(verifyCalls)}`)

  const rendered = (execute.state?.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n")
  const result = parseJsonish(rendered)
  const mapped = decodeNested(result.mapped)
  const verified = decodeNested(result.verified)
  const mappedPaths = [...(mapped.paths ?? [])].sort()
  const keptPaths = [...(verified.keptPaths ?? [])].sort()
  const removedPaths = [...(verified.removedPaths ?? [])].sort()

  const expectedMapped = ["src/a.ts", "src/b.ts", "src/d.ts"]
  const expectedKept = ["src/a.ts", "src/d.ts"]
  const expectedRemoved = ["src/b.ts"]
  if (JSON.stringify(mappedPaths) !== JSON.stringify(expectedMapped)) throw new Error(`unexpected mapped paths: ${JSON.stringify(mappedPaths)}`)
  if (JSON.stringify(keptPaths) !== JSON.stringify(expectedKept)) throw new Error(`unexpected kept paths: ${JSON.stringify(keptPaths)}`)
  if (JSON.stringify(removedPaths) !== JSON.stringify(expectedRemoved)) throw new Error(`unexpected removed paths: ${JSON.stringify(removedPaths)}`)
  if (verified.verification?.policy !== "conservative_precision_filter" || verified.verification?.uncertainty !== "keep") {
    throw new Error(`unexpected verification contract: ${JSON.stringify(verified.verification)}`)
  }

  const evidence = await captureOpenCodeSessionTree((route, init) => api(endpoint, route, init), rootSessionID)
  if (evidence.descendant_count !== 4) throw new Error(`expected 4 semantic child sessions, got ${evidence.descendant_count}`)
  const childModels = [...new Set(evidence.descendants.flatMap((record) => record.models))]
  if (childModels.length === 0 || childModels.some((value) => !value.startsWith("ollama-cloud/deepseek-v4.1-flash"))) {
    throw new Error(`unexpected child models: ${JSON.stringify(childModels)}`)
  }

  console.log(JSON.stringify({
    status: "PASS",
    model: modelSpec,
    mappedPaths,
    keptPaths,
    removedPaths,
    verification: verified.verification,
    nestedMapCalls: mapCalls.length,
    nestedVerifyCalls: verifyCalls.length,
    childSessions: evidence.descendant_count,
    childModels,
    rootUsage: evidence.root?.usage ?? null,
    childUsage: evidence.descendant_usage,
    totalUsage: evidence.total_usage,
  }, null, 2))
} finally {
  if (endpoint && rootSessionID) {
    const sessions = unwrap(await api(endpoint, "/api/session").catch(() => []))
    const ids = sessions
      .filter((session) => session.id === rootSessionID || session.parentID === rootSessionID)
      .map((session) => session.id)
    for (const id of ids.reverse()) await api(endpoint, `/api/session/${id}`, { method: "DELETE" }).catch(() => {})
  }
  if (pluginSpec) await run("opencode", ["plugin", "remove", pluginSpec], { timeoutMs: 30_000 }).catch(() => {})
  if (serviceStartedHere) await run("opencode", ["service", "stop"], { timeoutMs: 15_000 }).catch(() => {})
  await fs.rm(tempRoot, { recursive: true, force: true })
}
