import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

process.env.RLM_TEST_TURN_WALL_MS = "1000"

const { executeRlmExec } = await import("../rlm-lib/sandbox.ts")
const { RlmError } = await import("../rlm-lib/errors.ts")
const { turnGovernor } = await import("../rlm-lib/turn.ts")

const log = async () => {}

function clientFor(userMessageID) {
  const suffix = userMessageID.startsWith("user-") ? userMessageID.slice("user-".length) : userMessageID
  return {
    session: {
      messages: async () => ({ data: [
        { info: { id: userMessageID, role: "user" } },
        { info: { id: `assistant-${suffix}`, role: "assistant" } },
      ] }),
    },
    tool: { ids: async () => ({ data: ["read"] }) },
    file: {},
  }
}

test("external sandbox process termination fails closed and releases turn wall reservation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-envelope-root-"))
  const bin = await mkdtemp(path.join(tmpdir(), "rlm-envelope-bin-"))
  const previousPath = process.env.PATH
  const fakeDeno = path.join(bin, "deno")
  const sessionID = `root-kill-${Date.now()}-${Math.random()}`
  try {
    await writeFile(
      fakeDeno,
      '#!/usr/bin/env node\nprocess.stdin.resume(); setTimeout(() => process.exit(137), 25)\n',
    )
    await chmod(fakeDeno, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`

    const controller = new AbortController()
    await assert.rejects(
      () => executeRlmExec(clientFor("user-kill"), {
        code: 'return "must-not-succeed"',
        parentSessionID: sessionID,
        directory: root,
        worktree: root,
        messageID: "assistant-kill",
        abort: controller.signal,
        log,
      }),
      (error) => error instanceof RlmError
        && error.code === "RUNTIME_ERROR"
        && /sandbox exited with code 137/.test(error.message),
    )

    const snapshot = turnGovernor.snapshot(sessionID)
    assert.ok(snapshot, "turn state should remain observable after failed exec")
    assert.ok(snapshot.wallMsRemaining > 500, `expected released wall reservation, remaining=${snapshot.wallMsRemaining}`)
    assert.equal(snapshot.execCount, 1)
  } finally {
    turnGovernor.evictSession(sessionID)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
})

test("signal-killed sandbox settles after root abort instead of missing the exit event", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-envelope-signal-root-"))
  const bin = await mkdtemp(path.join(tmpdir(), "rlm-envelope-signal-bin-"))
  const previousPath = process.env.PATH
  const fakeDeno = path.join(bin, "deno")
  const sessionID = `root-signal-${Date.now()}-${Math.random()}`
  try {
    await writeFile(
      fakeDeno,
      '#!/usr/bin/env node\nprocess.stdin.resume(); setInterval(() => {}, 1000)\n',
    )
    await chmod(fakeDeno, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`

    const controller = new AbortController()
    const exec = executeRlmExec(clientFor("user-signal"), {
      code: 'return "must-not-succeed"',
      parentSessionID: sessionID,
      directory: root,
      worktree: root,
      messageID: "assistant-signal",
      abort: controller.signal,
      log,
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    controller.abort()

    const outcome = await Promise.race([
      exec.then(() => ({ resolved: true }), (error) => ({ error })),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 500)),
    ])
    assert.equal(outcome.timeout, undefined, "signal-killed sandbox remained pending after root abort")
    assert.ok(outcome.error instanceof RlmError)
    assert.equal(outcome.error.code, "RUNTIME_ERROR")

    const snapshot = turnGovernor.snapshot(sessionID)
    assert.ok(snapshot, "turn state should remain observable after root abort")
    assert.ok(snapshot.wallMsRemaining > 500, `expected released wall reservation, remaining=${snapshot.wallMsRemaining}`)
  } finally {
    turnGovernor.evictSession(sessionID)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
})

test("sandbox spawn strips ambient Deno permission broker authority", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-envelope-broker-root-"))
  const bin = await mkdtemp(path.join(tmpdir(), "rlm-envelope-broker-bin-"))
  const previousPath = process.env.PATH
  const previousBroker = process.env.DENO_PERMISSION_BROKER_PATH
  const fakeDeno = path.join(bin, "deno")
  const sessionID = `root-broker-${Date.now()}-${Math.random()}`
  try {
    await writeFile(
      fakeDeno,
      `#!/usr/bin/env node
if (process.env.DENO_PERMISSION_BROKER_PATH) {
  console.error("permission broker leaked into sandbox transport")
  process.exit(86)
}
let input = ""
let sent = false
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  input += chunk
  const nl = input.indexOf("\\n")
  if (sent || nl === -1) return
  sent = true
  const bootstrap = JSON.parse(input.slice(0, nl))
  const frame = \`RLM1:\${bootstrap.channel}:\${JSON.stringify({ v: 1, type: "result", value: "broker-sanitized" })}\\n\`
  process.stdout.write(frame, () => process.exit(0))
})
`,
    )
    await chmod(fakeDeno, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`
    process.env.DENO_PERMISSION_BROKER_PATH = "/tmp/rlm-host-broker.sock"

    const outcome = await executeRlmExec(clientFor("user-broker"), {
      code: 'return "ignored-by-fake-transport"',
      parentSessionID: sessionID,
      directory: root,
      worktree: root,
      messageID: "assistant-broker",
      abort: new AbortController().signal,
      log,
    })
    assert.equal(outcome.output, "broker-sanitized")
    assert.equal(outcome.metadata.exitCode, 0)
  } finally {
    turnGovernor.evictSession(sessionID)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousBroker === undefined) delete process.env.DENO_PERMISSION_BROKER_PATH
    else process.env.DENO_PERMISSION_BROKER_PATH = previousBroker
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
})

test("pre-aborted exec fails before touching SDK or sandbox authority", async () => {
  let calls = 0
  const touched = () => {
    calls++
    throw new Error("must not be called")
  }
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    () => executeRlmExec({
      session: { messages: touched },
      tool: { ids: touched },
      file: new Proxy({}, { get: touched }),
    }, {
      code: 'return "must-not-run"',
      parentSessionID: "pre-aborted-root",
      directory: "/definitely/not/an/rlm/workspace",
      worktree: "/definitely/not/an/rlm/workspace",
      messageID: "assistant-pre-aborted",
      abort: controller.signal,
      log,
    }),
    (error) => error instanceof RlmError
      && error.code === "RUNTIME_ERROR"
      && /parent request already aborted/.test(error.message),
  )
  assert.equal(calls, 0)
})

test("sandbox protocol preserves UTF-8 when a code point is split across stdout chunks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-envelope-utf8-root-"))
  const bin = await mkdtemp(path.join(tmpdir(), "rlm-envelope-utf8-bin-"))
  const previousPath = process.env.PATH
  const fakeDeno = path.join(bin, "deno")
  const sessionID = `root-utf8-${Date.now()}-${Math.random()}`
  try {
    await writeFile(
      fakeDeno,
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
  const frame = \`RLM1:\${bootstrap.channel}:\${JSON.stringify({ v: 1, type: "result", value: "left🙂right" })}\\n\`
  const bytes = Buffer.from(frame, "utf8")
  const emojiStart = bytes.indexOf(Buffer.from("🙂", "utf8"))
  if (emojiStart < 0) process.exit(2)
  process.stdout.write(bytes.subarray(0, emojiStart + 1))
  setTimeout(() => {
    process.stdout.write(bytes.subarray(emojiStart + 1), () => process.exit(0))
  }, 20)
})
`,
    )
    await chmod(fakeDeno, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`

    const outcome = await executeRlmExec(clientFor("user-utf8"), {
      code: 'return "ignored-by-fake-transport"',
      parentSessionID: sessionID,
      directory: root,
      worktree: root,
      messageID: "assistant-utf8",
      abort: new AbortController().signal,
      log,
    })

    assert.equal(outcome.output, "left🙂right")
    assert.equal(outcome.metadata.exitCode, 0)
  } finally {
    turnGovernor.evictSession(sessionID)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
})

test("sandbox stdin EPIPE fails the exec without crashing the host process", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-envelope-epipe-root-"))
  const bin = await mkdtemp(path.join(tmpdir(), "rlm-envelope-epipe-bin-"))
  const previousPath = process.env.PATH
  const fakeDeno = path.join(bin, "deno")
  const sessionID = `root-epipe-${Date.now()}-${Math.random()}`
  try {
    await writeFile(
      fakeDeno,
      `#!/usr/bin/env bash
IFS= read -r line
if [[ "$line" =~ \\"channel\\":\\"([a-f0-9]{48})\\" ]]; then
  channel="\${BASH_REMATCH[1]}"
else
  exit 2
fi
exec 0<&-
printf 'RLM1:%s:{"v":1,"type":"context","id":"closed-stdin","operation":"files","query":""}\\n' "$channel"
sleep 0.5
`,
    )
    await chmod(fakeDeno, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`

    await assert.rejects(
      () => executeRlmExec(clientFor("user-epipe"), {
        code: 'return "must-not-succeed"',
        parentSessionID: sessionID,
        directory: root,
        worktree: root,
        messageID: "assistant-epipe",
        abort: new AbortController().signal,
        log,
      }),
      (error) => error instanceof RlmError
        && error.code === "RUNTIME_ERROR"
        && /sandbox stdin failed/.test(error.message)
        && /EPIPE|broken pipe/i.test(error.message),
    )

    const snapshot = turnGovernor.snapshot(sessionID)
    assert.ok(snapshot, "turn state should remain observable after stdin failure")
    assert.ok(snapshot.wallMsRemaining > 500, `expected released wall reservation, remaining=${snapshot.wallMsRemaining}`)
  } finally {
    turnGovernor.evictSession(sessionID)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
})
