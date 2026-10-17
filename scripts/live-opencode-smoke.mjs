import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..")
const modelSpec = process.env.RLM_LIVE_OPENCODE_MODEL?.trim() || "opencode/glm-5.3-flash-free"
const recursive = process.argv.includes("--recursive")
const requestTimeoutMs = 90_000

function parseModel(spec) {
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) throw new Error(`Invalid model spec: ${spec}`)
  const providerID = spec.slice(0, slash)
  const rawModel = spec.slice(slash + 1)
  const hash = rawModel.lastIndexOf("#")
  if (hash < 0) return { providerID, id: rawModel }
  return { providerID, id: rawModel.slice(0, hash), variant: rawModel.slice(hash + 1) }
}

function run(command, args, { cwd = repoRoot, env = process.env, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("exit", (code, signal) => {
      clearTimeout(timer)
      if (code === 0) return resolve({ stdout, stderr })
      reject(new Error([
        `${command} ${args.join(" ")} failed (${signal ?? code})`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join("\n")))
    })
  })
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : undefined
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function copyWorktree(destination) {
  const excluded = new Set([".git", "node_modules", ".opencode", ".tmp", "coverage"])
  await fs.cp(repoRoot, destination, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repoRoot, source)
      if (!relative) return true
      return !excluded.has(relative.split(path.sep)[0])
    },
  })
}

async function waitForFile(file, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8"))
      if (predicate(value)) return value
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function waitForPlugin(env, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (Date.now() < deadline) {
    try {
      const result = await run("opencode", ["plugin", "list"], { env, timeoutMs: 5_000 })
      last = result.stdout
      if (/^rlm\s/m.test(last)) return
    } catch (error) {
      last = String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Installed RLM plugin was not active after startup:\n${last}`)
}

async function api(base, authorization, route, init = {}) {
  const response = await fetch(base + route, {
    ...init,
    headers: {
      authorization,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(requestTimeoutMs),
  })
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${route}: HTTP ${response.status}: ${await response.text()}`)
  }
  return response.status === 204 ? null : response.json()
}

async function runRlmCase({ base, authorization, model, title, code, expected }) {
  const created = await api(base, authorization, "/api/session", {
    method: "POST",
    body: JSON.stringify({
      title,
      model,
      location: { directory: repoRoot },
    }),
  })
  const session = created.data ?? created
  const escapedCode = JSON.stringify(code)
  const prompt = [
    "Use the execute tool exactly once.",
    `In it run exactly this JavaScript: return await tools.rlm_exec({ code: ${escapedCode} })`,
    "Return only the tool result.",
  ].join(" ")

  await api(base, authorization, `/api/session/${session.id}/prompt`, {
    method: "POST",
    body: JSON.stringify({ text: prompt }),
  })
  await api(base, authorization, `/api/experimental/session/${session.id}/wait`, { method: "POST" })
  const result = await api(base, authorization, `/api/session/${session.id}/message`)
  const messages = result.data ?? result
  const assistants = messages.filter((message) => message.type === "assistant")
  const parts = assistants.flatMap((message) => message.content ?? [])
  const execute = parts.find((part) => part.type === "tool" && part.name === "execute")
  if (!execute) throw new Error(`OpenCode model did not invoke Code Mode execute: ${JSON.stringify(assistants.map((message) => ({ finish: message.finish, error: message.error, model: message.model, content: message.content })))}`)
  if (execute.state?.status !== "completed") {
    throw new Error(`Code Mode execute failed: ${JSON.stringify(execute.state)}`)
  }
  const nested = execute.state?.metadata?.toolCalls?.find((call) => call.tool === "rlm_exec")
  if (!nested) throw new Error(`Code Mode execute did not invoke rlm_exec: ${JSON.stringify(execute.state)}`)
  if (nested.status !== "completed") throw new Error(`rlm_exec failed: ${JSON.stringify(execute.state)}`)
  const rendered = JSON.stringify(execute.state?.content ?? [])
  if (!rendered.includes(expected)) throw new Error(`rlm_exec result did not contain ${JSON.stringify(expected)}: ${rendered}`)
  return session.id
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rlm-opencode-live-"))
const snapshot = path.join(tempRoot, "package")
const home = path.join(tempRoot, "home")
const configHome = path.join(home, ".config")
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: configHome,
  XDG_DATA_HOME: path.join(home, ".local", "share"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  XDG_STATE_HOME: path.join(home, ".local", "state"),
}
let serviceStarted = false

try {
  await fs.mkdir(home, { recursive: true })
  await copyWorktree(snapshot)
  await run("git", ["init", "-q"], { cwd: snapshot })
  await run("git", ["config", "user.name", "RLM Live Smoke"], { cwd: snapshot })
  await run("git", ["config", "user.email", "rlm-live@example.invalid"], { cwd: snapshot })
  await run("git", ["add", "-A"], { cwd: snapshot })
  await run("git", ["commit", "-qm", "live smoke snapshot"], { cwd: snapshot })

  const port = await getFreePort()
  await run("opencode", ["service", "set", "port", String(port)], { env })
  await run("opencode", ["plugin", "add", `git+${pathToFileURL(snapshot).href}`], { env, timeoutMs: 60_000 })
  await run("opencode", ["service", "start"], { env, timeoutMs: 30_000 })
  serviceStarted = true

  const serviceFile = path.join(configHome, "opencode", "service.json")
  const service = await waitForFile(serviceFile, (value) => typeof value.password === "string" && value.password.length > 0)
  const authorization = `Basic ${Buffer.from(`opencode:${service.password}`).toString("base64")}`
  const base = `http://127.0.0.1:${port}`
  await waitForPlugin(env)

  const model = parseModel(modelSpec)
  const simpleSession = await runRlmCase({
    base,
    authorization,
    model,
    title: "rlm-live-smoke",
    code: "return { ok: true, value: 42 }",
    expected: "42",
  })
  console.log(`OpenCode live smoke PASS (${modelSpec}, session ${simpleSession})`)

  if (recursive) {
    const recursiveSession = await runRlmCase({
      base,
      authorization,
      model,
      title: "rlm-live-recursive-smoke",
      code: 'return await llm("Reply with exactly CHILD_OK")',
      expected: "CHILD_OK",
    })
    console.log(`OpenCode recursive live smoke PASS (${modelSpec}, session ${recursiveSession})`)
  }
} finally {
  if (serviceStarted) {
    try { await run("opencode", ["service", "stop"], { env, timeoutMs: 15_000 }) } catch {}
  }
  await fs.rm(tempRoot, { recursive: true, force: true })
}
