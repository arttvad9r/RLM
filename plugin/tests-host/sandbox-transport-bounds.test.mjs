import assert from "node:assert/strict"
import { getEventListeners } from "node:events"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

process.env.RLM_TEST_TURN_WALL_MS = "1000"

const { MAX_IGNORED_STDOUT_LINES } = await import("../rlm-lib/constants.ts")
const { executeRlmExec } = await import("../rlm-lib/sandbox.ts")
const { RlmError } = await import("../rlm-lib/errors.ts")
const { turnGovernor } = await import("../rlm-lib/turn.ts")

const log = async () => {}

function clientFor(suffix) {
  return {
    session: {
      messages: async () => ({ data: [
        { info: { id: `user-${suffix}`, role: "user" } },
        { info: { id: `assistant-${suffix}`, role: "assistant" } },
      ] }),
    },
    tool: { ids: async () => ({ data: ["read"] }) },
    file: {},
  }
}

async function withFakeDeno(source, run) {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-transport-root-"))
  const bin = await mkdtemp(path.join(tmpdir(), "rlm-transport-bin-"))
  const previousPath = process.env.PATH
  try {
    const fakeDeno = path.join(bin, "deno")
    await writeFile(fakeDeno, source)
    await chmod(fakeDeno, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
    return await run(root)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
}

test("unauthenticated stdout flood fails closed before the watchdog", async () => {
  const suffix = `flood-${Date.now()}-${Math.random()}`
  const sessionID = `root-${suffix}`
  try {
    await withFakeDeno(
      `#!/usr/bin/env node
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  input += chunk
  if (!input.includes("\\n")) return
  for (let i = 0; i < ${MAX_IGNORED_STDOUT_LINES + 1}; i++) process.stdout.write("noise-" + i + "\\n")
  setInterval(() => {}, 1000)
})
`,
      async (root) => {
        await assert.rejects(
          () => executeRlmExec(clientFor(suffix), {
            code: 'return "must-not-succeed"',
            parentSessionID: sessionID,
            directory: root,
            worktree: root,
            messageID: `assistant-${suffix}`,
            abort: new AbortController().signal,
            log,
          }),
          (error) => error instanceof RlmError
            && error.code === "PROTOCOL_ERROR"
            && /unauthenticated stdout exceeds limit/.test(error.message),
        )
      },
    )
  } finally {
    turnGovernor.evictSession(sessionID)
  }
})

test("parent abort listener is removed after successful sandbox settlement", async () => {
  const suffix = `listener-${Date.now()}-${Math.random()}`
  const sessionID = `root-${suffix}`
  const controller = new AbortController()
  try {
    await withFakeDeno(
      `#!/usr/bin/env node
let input = ""
let sent = false
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  input += chunk
  const nl = input.indexOf("\\n")
  if (sent || nl === -1) return
  sent = true
  const bootstrap = JSON.parse(input.slice(0, nl))
  const frame = \`RLM1:\${bootstrap.channel}:\${JSON.stringify({ v: 1, type: "result", value: "ok" })}\\n\`
  process.stdout.write(frame, () => process.exit(0))
})
`,
      async (root) => {
        assert.equal(getEventListeners(controller.signal, "abort").length, 0)
        const outcome = await executeRlmExec(clientFor(suffix), {
          code: 'return "ignored"',
          parentSessionID: sessionID,
          directory: root,
          worktree: root,
          messageID: `assistant-${suffix}`,
          abort: controller.signal,
          log,
        })
        assert.equal(outcome.output, "ok")
        assert.equal(getEventListeners(controller.signal, "abort").length, 0)
      },
    )
  } finally {
    turnGovernor.evictSession(sessionID)
  }
})
