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
  return {
    session: {
      messages: async () => ({ data: [{ info: { id: userMessageID, role: "user" } }] }),
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
