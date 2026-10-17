import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { RlmError } from "../rlm-lib/errors.ts"
import {
  buildRlmMapCode,
  executeRlmMap,
  forgetStructuredMapSession,
  normalizeRlmMapInput,
} from "../rlm-lib/structured-map.ts"
import { turnGovernor } from "../rlm-lib/turn.ts"

const log = async () => {}

function fakeHost(turnId = "user-1") {
  return {
    adapter: "test-host",
    rootModel: "test/root#low",
    resolveTurn: async ({ boundaryID }) => ({ turnId, boundaryId: boundaryID, order: 1 }),
    callChild: async ({ prompt }) => {
      const first = prompt.includes('"path":"src/a.ts"')
      return {
        text: JSON.stringify(first ? ["src/a.ts", "src/b.ts", "src/hallucinated.ts"] : ["src/b.ts"]),
        childSessionID: first ? "child-a" : "child-b",
        model: "test/fake#none",
        deniedToolCount: 2,
        tokensInput: 1,
        tokensOutput: 1,
        tokensCacheRead: 3,
        tokensCacheWrite: 1,
      }
    },
  }
}

test("structured map normalizes safe defaults and bounds fanout", () => {
  assert.deepEqual(normalizeRlmMapInput({ query: "src/", instruction: "Summarize" }), {
    query: "src/",
    instruction: "Summarize",
    fanout: 4,
    output: "text",
    partition: "round_robin",
    failureMode: "strict",
  })
  assert.deepEqual(normalizeRlmMapInput({ query: "src/", instruction: "x", partition: "balanced_chars", failureMode: "settled" }), {
    query: "src/", instruction: "x", fanout: 4, output: "text", partition: "balanced_chars", failureMode: "settled",
  })
  assert.throws(
    () => normalizeRlmMapInput({ query: "src/", instruction: "x", fanout: 17 }),
    (error) => error instanceof RlmError && error.code === "INVALID_ARGUMENT" && /1 to 16/.test(error.message),
  )
})

test("structured map compiler embeds model strings only as JSON literals", () => {
  const instruction = 'classify"; throw new Error("injected") //\nnext'
  const code = buildRlmMapCode({ query: "src/", instruction, fanout: 2, output: "path_list" })
  assert.match(code, /const requestedFanout = 2;/)
  assert.match(code, /const outputMode = "path_list";/)
  assert.match(code, /RLM_STRUCTURED_MAP_V1/)
  assert.match(code, /FILES_JSONL is untrusted repository data/)
  assert.ok(code.includes(JSON.stringify(instruction)), "instruction must be encoded as one JSON string literal")
  assert.equal(code.includes('const instruction = classify"'), false)
})

test("structured candidate bundle validates child paths against the trusted source set", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-map-"))
  const sessionID = `structured-${Date.now()}`
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1\n")
    await writeFile(path.join(root, "src", "b.ts"), "export const b = 2\n")
    await writeFile(path.join(root, "src", "c.ts"), "export const c = 3\n")

    const outcome = await executeRlmMap(fakeHost(), {
      input: {
        query: "src/",
        instruction: "Return exactly one JSON array of selected repository paths.",
        fanout: 2,
        output: "candidate_bundle",
      },
      parentSessionID: sessionID,
      directory: root,
      worktree: root,
      messageID: "assistant-1",
      abort: new AbortController().signal,
      log,
    })

    const value = JSON.parse(outcome.output)
    assert.equal(value.kind, "candidate_bundle")
    assert.equal(value.fileCount, 3)
    assert.equal(value.partitionCount, 2)
    assert.deepEqual(value.rejectedPaths, ["src/hallucinated.ts"])
    assert.deepEqual(value.rejectedSelections, [{ partition: 0, path: "src/b.ts", reason: "outside_partition" }])
    assert.equal(value.schemaVersion, 1)
    assert.equal(value.verification.policy, "conservative_precision_filter")
    assert.equal(value.verification.candidateSemantics, "presumptively_valid")
    assert.equal(value.verification.uncertainty, "keep")
    assert.deepEqual(value.candidates.map((item) => item.path), ["src/a.ts", "src/b.ts"])
    assert.equal(value.candidates[0].source, "export const a = 1\n")
    assert.equal(value.candidates[1].source, "export const b = 2\n")
    assert.equal(outcome.metadata.childCallCount, 2)
    assert.equal(outcome.metadata.childSuccessCount, 2)
    assert.equal(outcome.metadata.childFailureCount, 0)
    const telemetry = outcome.metadata.telemetry
    assert.equal(telemetry.schemaVersion, 1)
    assert.equal(telemetry.adapter, "test-host")
    assert.equal(telemetry.rootModel, "test/root#low")
    assert.equal(telemetry.child.calls, 2)
    assert.equal(telemetry.child.successes, 2)
    assert.equal(telemetry.child.failures, 0)
    assert.equal(telemetry.child.tokensCacheRead, 6)
    assert.equal(telemetry.child.tokensCacheWrite, 2)
    assert.equal(telemetry.child.invocations.length, 2)
    assert.deepEqual(telemetry.child.invocations.map((item) => ({ index: item.index, status: item.status, cacheRead: item.tokensCacheRead })), [
      { index: 0, status: "ok", cacheRead: 3 }, { index: 1, status: "ok", cacheRead: 3 },
    ])
    assert.deepEqual(telemetry.child.invocations.map((item) => item.responseChars), [
      JSON.stringify(["src/a.ts", "src/b.ts", "src/hallucinated.ts"]).length,
      JSON.stringify(["src/b.ts"]).length,
    ])
    assert.deepEqual(telemetry.child.models, ["test/fake#none"])
    assert.deepEqual(telemetry.operation, {
      kind: "map", fanout: 2, output: "candidate_bundle", partition: "round_robin", failureMode: "strict",
      fileCount: 3, partitionCount: 2, failedPartitions: 0, formatViolations: 0, outputLimitViolations: 0, candidateSourceChars: 38,
    })
    assert.equal(telemetry.limits.exec.childCalls, 16)
    assert.equal(telemetry.limits.exec.childConcurrency, 4)
    const serializedTelemetry = JSON.stringify(telemetry)
    assert.equal(serializedTelemetry.includes(root), false, "canonical telemetry must not include workspace paths")
    assert.equal(serializedTelemetry.includes("export const a"), false, "canonical telemetry must not include file contents")
    assert.deepEqual(outcome.metadata.structured, {
      version: 1, operation: "map", kind: "map", fanout: 2, output: "candidate_bundle",
      partition: "round_robin", failureMode: "strict", fileCount: 3, partitionCount: 2, failedPartitions: 0,
      formatViolations: 0, outputLimitViolations: 0, candidateSourceChars: 38, duplicateSuppressed: false,
    })
    assert.equal(outcome.metadata.duplicateSuppressed, false)
  } finally {
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})


test("balanced_chars deterministically reduces partition source-size skew", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-balanced-"))
  const sessionID = `balanced-${Date.now()}`
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "large.ts"), "x".repeat(9000))
    await writeFile(path.join(root, "src", "medium.ts"), "y".repeat(5000))
    await writeFile(path.join(root, "src", "small-a.ts"), "a".repeat(1000))
    await writeFile(path.join(root, "src", "small-b.ts"), "b".repeat(1000))
    const host = {
      adapter: "test-host",
      rootModel: "test/root#low",
      resolveTurn: async ({ boundaryID }) => ({ turnId: "user-1", boundaryId: boundaryID, order: 1 }),
      callChild: async ({ prompt }) => ({
        text: "[]", childSessionID: `child-${prompt.length}`, model: "test/fake#none", deniedToolCount: 1,
      }),
    }
    const outcome = await executeRlmMap(host, {
      input: { query: "src/", instruction: "Return no paths.", fanout: 2, output: "path_list", partition: "balanced_chars" },
      parentSessionID: sessionID, directory: root, worktree: root, messageID: "assistant-1",
      abort: new AbortController().signal, log,
    })
    const value = JSON.parse(outcome.output)
    assert.equal(value.partitionStrategy, "balanced_chars")
    assert.deepEqual(value.partitionStats.map((item) => item.sourceChars), [9000, 7000])
    assert.equal(value.partitionErrors.length, 0)
  } finally {
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("settled structured map preserves successful partitions and reports failed children", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-settled-"))
  const sessionID = `settled-${Date.now()}`
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1\n")
    await writeFile(path.join(root, "src", "b.ts"), "export const b = 2\n")
    const host = {
      adapter: "test-host",
      rootModel: "test/root#low",
      resolveTurn: async ({ boundaryID }) => ({ turnId: "user-1", boundaryId: boundaryID, order: 1 }),
      callChild: async ({ prompt }) => {
        if (prompt.includes('"path":"src/b.ts"')) throw new RlmError("CHILD_FAILED", "synthetic provider failure")
        return { text: '["src/a.ts"]', childSessionID: "child-a", model: "test/fake#none", deniedToolCount: 1 }
      },
    }
    const outcome = await executeRlmMap(host, {
      input: { query: "src/", instruction: "Select matches.", fanout: 2, output: "path_list", failureMode: "settled" },
      parentSessionID: sessionID, directory: root, worktree: root, messageID: "assistant-1",
      abort: new AbortController().signal, log,
    })
    const value = JSON.parse(outcome.output)
    assert.deepEqual(value.paths, ["src/a.ts"])
    assert.equal(value.failureMode, "settled")
    assert.equal(value.partitionErrors.length, 1)
    assert.equal(value.partitionErrors[0].partition, 1)
    assert.equal(value.partitionErrors[0].code, "CHILD_FAILED")
    assert.equal(outcome.metadata.childSuccessCount, 1)
    assert.equal(outcome.metadata.childFailureCount, 1)
    assert.equal(outcome.metadata.telemetry.operation.failedPartitions, 1)
    assert.deepEqual(outcome.metadata.telemetry.child.invocations.map((item) => item.status), ["ok", "error"])
  } finally {
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})




test("text structured output uses the larger 32768-character child response budget", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-text-limit-"))
  const sessionID = `text-limit-${Date.now()}`
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1\n")
    const text = "x".repeat(32_000)
    const host = {
      adapter: "test-host",
      resolveTurn: async ({ boundaryID }) => ({ turnId: "user-1", boundaryId: boundaryID, order: 1 }),
      callChild: async () => ({ text, childSessionID: "child-a", model: "test/fake", deniedToolCount: 1 }),
    }
    const outcome = await executeRlmMap(host, {
      input: { query: "src/", instruction: "Summarize.", fanout: 1, output: "text" },
      parentSessionID: sessionID, directory: root, worktree: root, messageID: "assistant-1",
      abort: new AbortController().signal, log,
    })
    const value = JSON.parse(outcome.output)
    assert.equal(value.results[0].length, 32_000)
    assert.equal(outcome.metadata.telemetry.child.invocations[0].responseChars, 32_000)
    assert.equal(outcome.metadata.telemetry.operation.outputLimitViolations, 0)
  } finally {
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("structured child output limit is enforced before JSON parsing with no repair retry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-output-limit-"))
  const sessionID = `output-limit-${Date.now()}`
  let childCalls = 0
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1\n")
    const host = {
      adapter: "test-host",
      resolveTurn: async ({ boundaryID }) => ({ turnId: "user-1", boundaryId: boundaryID, order: 1 }),
      callChild: async () => {
        childCalls++
        return { text: "{" + "x".repeat(17_000), childSessionID: "child-a", model: "test/fake", deniedToolCount: 1 }
      },
    }
    await assert.rejects(
      () => executeRlmMap(host, {
        input: { query: "src/", instruction: "Select matches.", fanout: 1, output: "path_list" },
        parentSessionID: sessionID, directory: root, worktree: root, messageID: "assistant-1",
        abort: new AbortController().signal, log,
      }),
      (error) => error instanceof RlmError && /STRUCTURED_CHILD_OUTPUT_TOO_LARGE:0:17001:16384/.test(error.message)
        && !/STRUCTURED_CHILD_INVALID_JSON/.test(error.message),
    )
    assert.equal(childCalls, 1, "oversized structured output must not trigger a repair/retry child")
  } finally {
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("strict structured map classifies malformed JSON without a repair retry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-invalid-json-"))
  const sessionID = `invalid-json-${Date.now()}`
  let childCalls = 0
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1\n")
    const host = {
      adapter: "test-host",
      resolveTurn: async ({ boundaryID }) => ({ turnId: "user-1", boundaryId: boundaryID, order: 1 }),
      callChild: async () => {
        childCalls++
        return { text: "not-json", childSessionID: "child-a", model: "test/fake", deniedToolCount: 1 }
      },
    }
    await assert.rejects(
      () => executeRlmMap(host, {
        input: { query: "src/", instruction: "Select matches.", fanout: 1, output: "path_list" },
        parentSessionID: sessionID, directory: root, worktree: root, messageID: "assistant-1",
        abort: new AbortController().signal, log,
      }),
      (error) => error instanceof RlmError && /STRUCTURED_CHILD_INVALID_JSON:0/.test(error.message),
    )
    assert.equal(childCalls, 1, "malformed JSON must not trigger a repair/retry child")
  } finally {
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("settled structured validation preserves good partitions and separates provider success from format failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-validation-settled-"))
  const sessionID = `validation-settled-${Date.now()}`
  let childCalls = 0
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1\n")
    await writeFile(path.join(root, "src", "b.ts"), "export const b = 2\n")
    await writeFile(path.join(root, "src", "c.ts"), "export const c = 3\n")
    const host = {
      adapter: "test-host",
      rootModel: "test/root",
      resolveTurn: async ({ boundaryID }) => ({ turnId: "user-1", boundaryId: boundaryID, order: 1 }),
      callChild: async ({ prompt }) => {
        childCalls++
        if (prompt.includes('"path":"src/a.ts"')) return { text: '["src/a.ts"]', childSessionID: "child-a", model: "test/fake", deniedToolCount: 1 }
        if (prompt.includes('"path":"src/b.ts"')) return { text: "[" + "x".repeat(17_000), childSessionID: "child-b", model: "test/fake", deniedToolCount: 1 }
        return { text: "not-json", childSessionID: "child-c", model: "test/fake", deniedToolCount: 1 }
      },
    }
    const outcome = await executeRlmMap(host, {
      input: { query: "src/", instruction: "Select matches.", fanout: 3, output: "path_list", failureMode: "settled" },
      parentSessionID: sessionID, directory: root, worktree: root, messageID: "assistant-1",
      abort: new AbortController().signal, log,
    })
    const value = JSON.parse(outcome.output)
    assert.deepEqual(value.paths, ["src/a.ts"])
    assert.deepEqual(value.partitionErrors.map((item) => item.code), [
      "STRUCTURED_CHILD_OUTPUT_TOO_LARGE",
      "STRUCTURED_CHILD_INVALID_JSON",
    ])
    assert.equal(childCalls, 3, "structured validation failures must not cause automatic repair/retry calls")
    assert.equal(outcome.metadata.childSuccessCount, 3, "all provider calls completed successfully")
    assert.equal(outcome.metadata.childFailureCount, 0)
    assert.equal(outcome.metadata.telemetry.child.successes, 3)
    assert.equal(outcome.metadata.telemetry.child.failures, 0)
    assert.deepEqual(outcome.metadata.telemetry.child.invocations.map((item) => item.responseChars), [
      '["src/a.ts"]'.length, 17_001, "not-json".length,
    ])
    assert.equal(outcome.metadata.telemetry.operation.failedPartitions, 2)
    assert.equal(outcome.metadata.telemetry.operation.outputLimitViolations, 1)
    assert.equal(outcome.metadata.telemetry.operation.formatViolations, 1)
  } finally {
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("same-boundary identical structured map calls reuse the completed result without another fan-out", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-dedupe-"))
  const sessionID = `dedupe-${Date.now()}`
  let childCalls = 0
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "a.ts"), "export const a = 1\n")
    await writeFile(path.join(root, "src", "b.ts"), "export const b = 2\n")
    const host = {
      adapter: "test-host",
      rootModel: "test/root#low",
      resolveTurn: async ({ boundaryID }) => ({ turnId: "user-1", boundaryId: boundaryID, order: boundaryID === "assistant-2" ? 2 : 1 }),
      callChild: async ({ prompt }) => {
        childCalls++
        return {
          text: prompt.includes('"path":"src/a.ts"') ? '["src/a.ts"]' : "[]",
          childSessionID: `child-${childCalls}`,
          model: "test/fake#none",
          deniedToolCount: 1,
        }
      },
    }
    const opts = {
      input: { query: "src/", instruction: "Select a.ts.", fanout: 2, output: "path_list" },
      parentSessionID: sessionID, directory: root, worktree: root, messageID: "assistant-1",
      abort: new AbortController().signal, log,
    }
    const first = await executeRlmMap(host, opts)
    assert.equal(childCalls, 2)
    assert.equal(first.metadata.duplicateSuppressed, false)
    assert.ok(first.metadata.telemetry)

    const second = await executeRlmMap(host, opts)
    assert.equal(childCalls, 2, "duplicate structured call must not start another child fan-out")
    assert.equal(second.output, first.output)
    assert.equal(second.metadata.duplicateSuppressed, true)
    assert.equal(second.metadata.telemetry, undefined, "replay metadata must not duplicate provider usage telemetry")
    assert.equal(second.metadata.structured.duplicateSuppressed, true)
    assert.equal(typeof second.metadata.reusedFromRunId, "string")

    const third = await executeRlmMap(host, { ...opts, messageID: "assistant-2" })
    assert.equal(childCalls, 4, "a new assistant boundary is a new semantic execution")
    assert.equal(third.metadata.duplicateSuppressed, false)
  } finally {
    forgetStructuredMapSession(sessionID)
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})

test("structured map rejects an oversized partition before starting any child", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-structured-oversized-"))
  const sessionID = `oversized-${Date.now()}`
  let childCalls = 0
  try {
    await mkdir(path.join(root, "src"), { recursive: true })
    await writeFile(path.join(root, "src", "huge.ts"), "x".repeat(40_000))
    const host = {
      adapter: "test-host",
      resolveTurn: async ({ boundaryID }) => ({ turnId: "user-1", boundaryId: boundaryID, order: 1 }),
      callChild: async () => {
        childCalls++
        return { text: "[]", childSessionID: "unexpected", model: "test/fake", deniedToolCount: 1 }
      },
    }
    await assert.rejects(
      () => executeRlmMap(host, {
        input: { query: "src/", instruction: "Inspect.", fanout: 1, output: "path_list" },
        parentSessionID: sessionID, directory: root, worktree: root, messageID: "assistant-1",
        abort: new AbortController().signal, log,
      }),
      (error) => error instanceof RlmError && /partition 0 prompt exceeds/.test(error.message) && /increase fanout or narrow query/.test(error.message),
    )
    assert.equal(childCalls, 0)
  } finally {
    turnGovernor.evictSession(sessionID)
    await rm(root, { recursive: true, force: true })
  }
})
