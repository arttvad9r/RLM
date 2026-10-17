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

function hostFor(userMessageID) {
  const assistantMessageID = `assistant-${userMessageID.replace(/^user-/, "")}`
  return {
    resolveTurn: async ({ boundaryID }) => {
      assert.equal(boundaryID, assistantMessageID)
      return { turnId: userMessageID, boundaryId: assistantMessageID, order: 1 }
    },
    callChild: async () => {
      throw new Error("process envelope tests must not invoke child models")
    },
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
      `#!${process.execPath}\nprocess.stdin.resume(); setTimeout(() => process.exit(137), 25)\n`,
    )
    await chmod(fakeDeno, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`

    const controller = new AbortController()
    await assert.rejects(
      () => executeRlmExec(hostFor("user-kill"), {
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

test("sandbox protocol preserves UTF-8 when a code point is split across stdout chunks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-envelope-utf8-root-"))
  const bin = await mkdtemp(path.join(tmpdir(), "rlm-envelope-utf8-bin-"))
  const previousPath = process.env.PATH
  const fakeDeno = path.join(bin, "deno")
  const sessionID = `root-utf8-${Date.now()}-${Math.random()}`
  try {
    await writeFile(
      fakeDeno,
      `#!${process.execPath}
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

    const outcome = await executeRlmExec(hostFor("user-utf8"), {
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
      `#!/bin/bash
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
      () => executeRlmExec(hostFor("user-epipe"), {
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
    assert.ok(snapshot.wallMsRemaining > 0, `expected released wall reservation, remaining=${snapshot.wallMsRemaining}`)
  } finally {
    turnGovernor.evictSession(sessionID)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
})


test("working memory persists across sandbox processes within one authoritative turn", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-memory-root-"))
  const bin = await mkdtemp(path.join(tmpdir(), "rlm-memory-bin-"))
  const previousPath = process.env.PATH
  const fakeDeno = path.join(bin, "deno")
  const sessionID = `root-memory-${Date.now()}-${Math.random()}`
  try {
    await writeFile(
      fakeDeno,
      `#!${process.execPath}
let input = ""
let channel = ""
let mode = ""
const send = (message) => process.stdout.write(\`RLM1:\${channel}:\${JSON.stringify(message)}\\n\`)
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  input += chunk
  for (;;) {
    const nl = input.indexOf("\\n")
    if (nl < 0) break
    const line = input.slice(0, nl).trim()
    input = input.slice(nl + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (!channel) {
      channel = message.channel
      mode = message.code
      if (mode === "set") {
        send({ v: 1, type: "memory", id: "memory-set", operation: "set", key: "audit:candidates", value: { paths: ["src/a.ts"] } })
      } else {
        send({ v: 1, type: "memory", id: "memory-get", operation: "get", key: "audit:candidates" })
      }
      continue
    }
    if (message.type !== "memory_result" || !message.ok) process.exit(3)
    if (mode === "set") send({ v: 1, type: "result", value: "stored" })
    else send({ v: 1, type: "result", value: message.value })
    setImmediate(() => process.exit(0))
  }
})
`,
    )
    await chmod(fakeDeno, 0o755)
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`

    const host = hostFor("user-memory")
    const first = await executeRlmExec(host, {
      code: "set",
      parentSessionID: sessionID,
      directory: root,
      worktree: root,
      messageID: "assistant-memory",
      abort: new AbortController().signal,
      log,
    })
    assert.equal(first.output, "stored")
    assert.equal(first.metadata.memoryCallCount, 1)
    assert.equal(first.metadata.turnMemoryEntries, 1)

    const second = await executeRlmExec(host, {
      code: "get",
      parentSessionID: sessionID,
      directory: root,
      worktree: root,
      messageID: "assistant-memory",
      abort: new AbortController().signal,
      log,
    })
    assert.deepEqual(JSON.parse(second.output), { found: true, value: { paths: ["src/a.ts"] } })
    assert.equal(second.metadata.memoryCallCount, 1)
    assert.equal(second.metadata.turnMemoryEntries, 1)
  } finally {
    turnGovernor.evictSession(sessionID)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(root, { recursive: true, force: true })
    await rm(bin, { recursive: true, force: true })
  }
})
