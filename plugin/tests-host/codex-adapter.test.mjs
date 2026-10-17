import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  CodexRlmHost,
  codexChildArgs,
  parseCodexChildJsonl,
  parseCodexInvocationContext,
} from "../../adapters/codex/codex-host.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { TurnGovernor } from "../rlm-lib/turn.ts"

function meta(overrides = {}) {
  return {
    threadId: "thread-1",
    "x-codex-turn-metadata": {
      thread_id: "thread-1",
      turn_id: "turn-1",
      turn_started_at_unix_ms: 123456789,
      model: "gpt-test",
      reasoning_effort: "low",
      workspaces: { "/repo": {} },
      ...overrides,
    },
  }
}

test("Codex metadata resolves authoritative thread, turn, model and workspace", () => {
  assert.deepEqual(parseCodexInvocationContext(meta(), "/unrelated"), {
    threadId: "thread-1",
    turnId: "turn-1",
    turnStartedAtUnixMs: 123456789,
    model: "gpt-test",
    reasoningEffort: "low",
    workspaceRoot: "/repo",
  })
})

test("Codex metadata fails closed on thread mismatch and ambiguous workspaces", () => {
  assert.throws(
    () => parseCodexInvocationContext(meta({ thread_id: "other-thread" }), "/repo"),
    (error) => error instanceof RlmError && /thread identity mismatch/.test(error.message),
  )
  assert.throws(
    () => parseCodexInvocationContext(meta({ workspaces: { "/a": {}, "/b": {} } }), "/server"),
    (error) => error instanceof RlmError && /multiple workspaces/.test(error.message),
  )
  assert.equal(
    parseCodexInvocationContext(meta({ workspaces: { "/a": {}, "/b": {} } }), "/b").workspaceRoot,
    "/b",
  )
})

test("Codex child arguments isolate filesystem, network, config and inherited shell environment", () => {
  const context = parseCodexInvocationContext(meta(), "/repo")
  const args = codexChildArgs(context, "/tmp/rlm-empty")
  const joined = args.join("\n")
  assert.ok(args.includes("--ignore-user-config"))
  assert.ok(args.includes("--ignore-rules"))
  assert.ok(args.includes("--ephemeral"))
  assert.ok(args.includes("read-only"))
  assert.match(joined, /permissions\.rlm_child\.filesystem=\{"\/"="deny"\}/)
  assert.match(joined, /permissions\.rlm_child\.network\.enabled=false/)
  assert.match(joined, /permissions\.rlm_child\.allow_login_shell=false/)
  assert.match(joined, /shell_environment_policy\.inherit="none"/)
  assert.match(joined, /include_environment_context=false/)
  assert.match(joined, /base_instructions=/)
  assert.equal(args.at(-1), "-")
  assert.equal(joined.includes("/repo"), false, "child command must not receive the parent workspace path")
})

test("Codex fixed child model overrides model and reasoning effort", () => {
  const context = parseCodexInvocationContext(meta(), "/repo")
  const args = codexChildArgs(context, "/tmp/rlm-empty", "gpt-6-luna", "low")
  const joined = args.join("\n")
  assert.equal(args[args.indexOf("-m") + 1], "gpt-6-luna")
  assert.match(joined, /model_reasoning_effort="low"/)
})

test("Codex JSONL parser returns the final agent message and usage", () => {
  const parsed = parseCodexChildJsonl([
    JSON.stringify({ type: "thread.started", thread_id: "child-thread" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "intermediate" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "FINAL" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, output_tokens: 3 } }),
  ].join("\n"))
  assert.deepEqual(parsed, {
    threadId: "child-thread",
    text: "FINAL",
    tokensInput: 12,
    tokensOutput: 3,
  })
})

test("Codex JSONL parser fails closed on malformed or incomplete output", () => {
  assert.throws(
    () => parseCodexChildJsonl("not-json"),
    (error) => error instanceof RlmError && /malformed JSONL/.test(error.message),
  )
  assert.throws(
    () => parseCodexChildJsonl(JSON.stringify({ type: "thread.started", thread_id: "child" })),
    (error) => error instanceof RlmError && /final agent message/.test(error.message),
  )
  assert.throws(
    () => parseCodexChildJsonl([
      JSON.stringify({ type: "thread.started", thread_id: "child" }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "partial" } }),
    ].join("\n")),
    (error) => error instanceof RlmError && /turn\.completed/.test(error.message),
  )
})

test("Codex host resolves only its captured thread, turn and workspace", async () => {
  const context = parseCodexInvocationContext(meta(), "/repo")
  const host = new CodexRlmHost(context)
  assert.equal(host.adapter, "codex-mcp")
  assert.equal(host.rootModel, "codex/gpt-test#low")
  assert.deepEqual(await host.resolveTurn({ sessionID: "thread-1", boundaryID: "turn-1", directory: "/repo" }), {
    turnId: "turn-1",
    boundaryId: "turn-1",
    order: 123456789,
  })
  await assert.rejects(
    () => host.resolveTurn({ sessionID: "thread-1", boundaryID: "turn-2", directory: "/repo" }),
    (error) => error instanceof RlmError && /turn identity changed/.test(error.message),
  )
})


test("Codex host preserves UTF-8 across split stdout chunks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rlm-codex-utf8-test-"))
  const fake = path.join(dir, "fake-codex")
  try {
    await writeFile(fake, `#!${process.execPath}
process.stdin.resume()
process.stdin.on("end", () => {
  const lines = [
    JSON.stringify({ type: "thread.started", thread_id: "child-utf8" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Я" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join("\\n") + "\\n"
  const bytes = Buffer.from(lines, "utf8")
  const needle = Buffer.from("Я", "utf8")
  const split = bytes.indexOf(needle) + 1
  process.stdout.write(bytes.subarray(0, split))
  setTimeout(() => process.stdout.write(bytes.subarray(split), () => process.exit(0)), 10)
})
`)
    await chmod(fake, 0o755)
    const host = new CodexRlmHost(parseCodexInvocationContext(meta(), "/repo"), fake)
    const result = await host.callChild({
      prompt: "hello",
      parentSessionID: "thread-1",
      directory: "/repo",
    }, async () => {})
    assert.equal(result.text, "Я")
    assert.equal(result.childSessionID, "child-utf8")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("Codex host converts child stdin EPIPE into CHILD_FAILED", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "rlm-codex-epipe-test-"))
  const fake = path.join(dir, "fake-codex")
  try {
    await writeFile(fake, `#!${process.execPath}
import fs from "node:fs"
fs.closeSync(0)
setTimeout(() => process.exit(0), 150)
`)
    await chmod(fake, 0o755)
    const host = new CodexRlmHost(parseCodexInvocationContext(meta(), "/repo"), fake)
    await assert.rejects(
      () => host.callChild({
        prompt: "x".repeat(4 * 1024 * 1024),
        parentSessionID: "thread-1",
        directory: "/repo",
      }, async () => {}),
      (error) => error instanceof RlmError && error.code === "CHILD_FAILED" && /stdin failed/i.test(error.message),
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("host turn transition succeeds after the prior exec finishes", async () => {
  const governor = new TurnGovernor()
  let resolved = { turnId: "turn-1", boundaryId: "turn-1", order: 1 }
  const host = { resolveTurn: async () => resolved }
  const first = await governor.beginHostExec(host, "session", "/repo", "turn-1", 1000)
  assert.equal(first.allowed, true)
  assert.equal(governor.finishExecForTurn("session", "turn-1", 5, first.reservedWallMs), true)

  resolved = { turnId: "turn-2", boundaryId: "turn-2", order: 2 }
  const second = await governor.beginHostExec(host, "session", "/repo", "turn-2", 1000)
  assert.equal(second.allowed, true)
  assert.equal(second.snapshot.turnId, "turn-2")
})
