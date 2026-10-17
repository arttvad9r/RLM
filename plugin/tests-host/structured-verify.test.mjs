import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { RlmError } from "../rlm-lib/errors.ts"
import {
  buildRlmVerifyCode,
  executeRlmVerify,
  forgetStructuredVerifySession,
  normalizeRlmVerifyInput,
} from "../rlm-lib/structured-verify.ts"
import { turnGovernor } from "../rlm-lib/turn.ts"

const log = async () => {}

function baseHost(callChild, turnId = "user-1") {
  return {
    adapter: "test-host",
    rootModel: "test/root#low",
    resolveTurn: async ({ boundaryID }) => ({ turnId, boundaryId: boundaryID, order: boundaryID === "assistant-2" ? 2 : 1 }),
    callChild,
  }
}

async function makeWorkspace(prefix, files) {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  await mkdir(path.join(root, "src"), { recursive: true })
  for (const [name, source] of Object.entries(files)) await writeFile(path.join(root, "src", name), source)
  return root
}

function opts(root, sessionID, input, messageID = "assistant-1") {
  return {
    input,
    parentSessionID: sessionID,
    directory: root,
    worktree: root,
    messageID,
    abort: new AbortController().signal,
    log,
  }
}

test("structured verify normalizes bounded candidates and safe defaults", () => {
  assert.deepEqual(normalizeRlmVerifyInput({ candidates: ["src/b.ts", "src/a.ts", "src/a.ts"], instruction: "Keep violations." }), {
    candidates: ["src/a.ts", "src/b.ts"],
    instruction: "Keep violations.",
    fanout: 4,
    partition: "round_robin",
    failureMode: "strict",
  })
  assert.throws(
    () => normalizeRlmVerifyInput({ candidates: Array.from({ length: 65 }, (_, i) => `src/${i}.ts`), instruction: "x" }),
    (error) => error instanceof RlmError && error.code === "INVALID_ARGUMENT" && /at most 64/.test(error.message),
  )
  assert.throws(
    () => normalizeRlmVerifyInput({ candidates: ["x".repeat(1025)], instruction: "x" }),
    (error) => error instanceof RlmError && /up to 1024/.test(error.message),
  )
})

test("structured verify compiler frames candidates as untrusted and embeds inputs as JSON literals", () => {
  const instruction = 'keep result mutations"; throw new Error("injected") //\nnext'
  const candidate = 'src/a"quote.ts'
  const code = buildRlmVerifyCode({ candidates: [candidate], instruction, fanout: 1 })
  assert.match(code, /RLM_STRUCTURED_VERIFY_V1/)
  assert.match(code, /presumptively valid/)
  assert.match(code, /uncertainty: "keep"/)
  assert.ok(code.includes(JSON.stringify(instruction)))
  assert.ok(code.includes(JSON.stringify([candidate])))
  assert.equal(code.includes('const instruction = keep result mutations"'), false)
})

test("conservative verify can only remove in-partition candidates and exposes bounded telemetry", async () => {
  const root = await makeWorkspace("rlm-verify-", {
    "a.ts": "export const a = 'violation'\n",
    "b.ts": "export const b = 'violation'\n",
    "c.ts": "export const c = 'safe exception'\n",
  })
  const sessionID = `verify-${Date.now()}`
  let childCalls = 0
  try {
    const host = baseHost(async ({ prompt }) => {
      childCalls++
      const first = prompt.includes('"path":"src/a.ts"')
      const text = first
        ? JSON.stringify(["src/c.ts", "src/b.ts", "src/hallucinated.ts"])
        : "[]"
      return {
        text,
        childSessionID: `child-${childCalls}`,
        model: "test/fake#none",
        deniedToolCount: 3,
        tokensInput: 2,
        tokensOutput: 1,
        tokensCacheRead: 4,
        tokensCacheWrite: 1,
      }
    })
    const outcome = await executeRlmVerify(host, opts(root, sessionID, {
      candidates: ["src/c.ts", "src/b.ts", "src/a.ts"],
      instruction: "A candidate is valid when it mutates observable result state before an awaited backend operation completes.",
      fanout: 2,
    }))
    const value = JSON.parse(outcome.output)
    assert.deepEqual(value.keptPaths, ["src/a.ts", "src/b.ts"])
    assert.deepEqual(value.removedPaths, ["src/c.ts"])
    assert.deepEqual(value.rejectedSelections, [
      { partition: 0, path: "src/b.ts", reason: "outside_partition" },
      { partition: 0, path: "src/hallucinated.ts", reason: "not_candidate" },
    ])
    assert.deepEqual(value.verification, {
      schemaVersion: 1,
      policy: "conservative_precision_filter",
      candidateSemantics: "presumptively_valid",
      decision: "remove_only_proven_exception",
      uncertainty: "keep",
    })
    assert.equal(childCalls, 2)
    assert.deepEqual(outcome.metadata.telemetry.operation, {
      kind: "verify",
      fanout: 2,
      partition: "round_robin",
      failureMode: "strict",
      candidateCount: 3,
      keptCount: 2,
      removedCount: 1,
      partitionCount: 2,
      failedPartitions: 0,
      formatViolations: 0,
      outputLimitViolations: 0,
    })
    assert.deepEqual(outcome.metadata.telemetry.child.invocations.map((item) => item.responseChars), [
      JSON.stringify(["src/c.ts", "src/b.ts", "src/hallucinated.ts"]).length,
      2,
    ])
    const telemetry = JSON.stringify(outcome.metadata.telemetry)
    assert.equal(telemetry.includes(root), false)
    assert.equal(telemetry.includes("safe exception"), false)
  } finally {
    forgetStructuredVerifySession(sessionID)
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("settled verify treats provider and format failures as uncertainty and keeps those candidates", async () => {
  const root = await makeWorkspace("rlm-verify-settled-", {
    "a.ts": "a\n", "b.ts": "b\n", "c.ts": "c\n",
  })
  const sessionID = `verify-settled-${Date.now()}`
  let childCalls = 0
  try {
    const host = baseHost(async ({ prompt }) => {
      childCalls++
      if (prompt.includes('"path":"src/a.ts"')) return { text: '["src/a.ts"]', childSessionID: "a", model: "test/fake", deniedToolCount: 1 }
      if (prompt.includes('"path":"src/b.ts"')) return { text: "not-json", childSessionID: "b", model: "test/fake", deniedToolCount: 1 }
      throw new RlmError("CHILD_FAILED", "synthetic provider failure")
    })
    const outcome = await executeRlmVerify(host, opts(root, sessionID, {
      candidates: ["src/a.ts", "src/b.ts", "src/c.ts"], instruction: "Keep candidates unless clearly safe.", fanout: 3, failureMode: "settled",
    }))
    const value = JSON.parse(outcome.output)
    assert.deepEqual(value.removedPaths, ["src/a.ts"])
    assert.deepEqual(value.keptPaths, ["src/b.ts", "src/c.ts"])
    assert.equal(childCalls, 3, "verification failures must not trigger repair/retry calls")
    assert.equal(outcome.metadata.childSuccessCount, 2)
    assert.equal(outcome.metadata.childFailureCount, 1)
    assert.equal(outcome.metadata.telemetry.operation.failedPartitions, 2)
    assert.equal(outcome.metadata.telemetry.operation.formatViolations, 1)
    assert.equal(outcome.metadata.telemetry.operation.outputLimitViolations, 0)
    assert.deepEqual(new Set(value.partitionErrors.map((item) => item.code)), new Set(["CHILD_FAILED", "STRUCTURED_CHILD_INVALID_JSON"]))
  } finally {
    forgetStructuredVerifySession(sessionID)
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("settled verify keeps a partition on oversized child output without repair", async () => {
  const root = await makeWorkspace("rlm-verify-limit-", { "a.ts": "a\n" })
  const sessionID = `verify-limit-${Date.now()}`
  let childCalls = 0
  try {
    const host = baseHost(async () => {
      childCalls++
      return { text: "[" + "x".repeat(17_000), childSessionID: "a", model: "test/fake", deniedToolCount: 1 }
    })
    const outcome = await executeRlmVerify(host, opts(root, sessionID, {
      candidates: ["src/a.ts"], instruction: "Keep unless clearly safe.", fanout: 1, failureMode: "settled",
    }))
    const value = JSON.parse(outcome.output)
    assert.deepEqual(value.keptPaths, ["src/a.ts"])
    assert.deepEqual(value.removedPaths, [])
    assert.equal(value.partitionErrors[0].code, "STRUCTURED_CHILD_OUTPUT_TOO_LARGE")
    assert.equal(childCalls, 1)
    assert.equal(outcome.metadata.childSuccessCount, 1, "provider call succeeded even though structured validation rejected its output")
    assert.equal(outcome.metadata.telemetry.operation.outputLimitViolations, 1)
  } finally {
    forgetStructuredVerifySession(sessionID)
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("same-boundary identical structured verify calls reuse the completed result", async () => {
  const root = await makeWorkspace("rlm-verify-dedupe-", { "a.ts": "a\n", "b.ts": "b\n" })
  const sessionID = `verify-dedupe-${Date.now()}`
  let childCalls = 0
  try {
    const host = baseHost(async () => {
      childCalls++
      return { text: "[]", childSessionID: `child-${childCalls}`, model: "test/fake", deniedToolCount: 1 }
    })
    const input = { candidates: ["src/a.ts", "src/b.ts"], instruction: "Keep both unless clearly excepted.", fanout: 2 }
    const first = await executeRlmVerify(host, opts(root, sessionID, input))
    assert.equal(childCalls, 2)
    assert.equal(first.metadata.duplicateSuppressed, false)
    const second = await executeRlmVerify(host, opts(root, sessionID, input))
    assert.equal(childCalls, 2)
    assert.equal(second.output, first.output)
    assert.equal(second.metadata.duplicateSuppressed, true)
    assert.equal(second.metadata.telemetry, undefined)
    assert.equal(typeof second.metadata.reusedFromRunId, "string")
    const third = await executeRlmVerify(host, opts(root, sessionID, input, "assistant-2"))
    assert.equal(childCalls, 4)
    assert.equal(third.metadata.duplicateSuppressed, false)
  } finally {
    forgetStructuredVerifySession(sessionID)
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("empty structured verify is a zero-child conservative no-op", async () => {
  const root = await makeWorkspace("rlm-verify-empty-", {})
  const sessionID = `verify-empty-${Date.now()}`
  let childCalls = 0
  try {
    const host = baseHost(async () => { childCalls++; throw new Error("unexpected child") })
    const outcome = await executeRlmVerify(host, opts(root, sessionID, { candidates: [], instruction: "Keep valid candidates." }))
    const value = JSON.parse(outcome.output)
    assert.deepEqual(value.keptPaths, [])
    assert.deepEqual(value.removedPaths, [])
    assert.equal(value.partitionCount, 0)
    assert.equal(childCalls, 0)
    assert.equal(outcome.metadata.telemetry.operation.candidateCount, 0)
  } finally {
    forgetStructuredVerifySession(sessionID)
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})
