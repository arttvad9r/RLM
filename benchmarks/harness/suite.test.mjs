import assert from "node:assert/strict"
import test from "node:test"
import { sha256 } from "./lib.mjs"
import { compareSemanticStateAuditSuite } from "./suite-lib.mjs"

const TASK_HASH = "c".repeat(64)
const CONFIG_HASH = "b".repeat(64)
const SOURCE_COMMIT = "a".repeat(40)
const MODEL = { provider_id: "provider", model_id: "model", variant: "high" }

function scoreReport({ benchmarkId, total, mode, runId, sourceCommit = SOURCE_COMMIT, configHash = CONFIG_HASH, model = MODEL }) {
  const benchmarkSalt = benchmarkId.includes("384") ? "e" : "d"
  const corpusSalt = benchmarkId.includes("384") ? "2" : "1"
  const rlm = mode === "rlm"
  const usage = {
    wall_ms: rlm ? 1500 : 1000,
    root_input_tokens: 100,
    root_output_tokens: 50,
    child_input_tokens: 0,
    child_output_tokens: 0,
    cost_usd: null,
    rlm_exec_count: rlm ? 1 : 0,
    rlm_child_calls: 0,
    rlm_context_calls: 0,
    rlm_context_chars: 0,
    total_tokens: 150,
  }
  return {
    schema_version: 2,
    kind: "rlm_benchmark_score",
    benchmark_id: benchmarkId,
    run: {
      run_id: runId,
      mode,
      source_commit: sourceCommit,
      task_prompt_sha256: TASK_HASH,
      experiment_config_sha256: configHash,
      model,
      started_at: "2026-08-19T12:00:00Z",
      finished_at: "2026-08-19T12:00:01Z",
      usage,
    },
    integrity: {
      manifest_ground_truth_sha256: benchmarkSalt.repeat(64),
      actual_ground_truth_sha256: benchmarkSalt.repeat(64),
      manifest_corpus_aggregate_sha256: corpusSalt.repeat(64),
      actual_corpus_aggregate_sha256: corpusSalt.repeat(64),
      canonical_task_prompt_sha256: TASK_HASH,
      canonical_experiment_config_sha256: configHash,
      run_sha256: sha256(Buffer.from(`${benchmarkId}:${runId}:${mode}`)),
    },
    counts: {
      total,
      expected_violations: 0,
      predicted_violations: 0,
      tp: 0,
      fp: 0,
      fn: 0,
      tn: total,
    },
    metrics: {
      violation_precision: 0,
      violation_recall: 0,
      violation_f1: 0,
      specificity: 1,
      accuracy: 1,
      balanced_accuracy: 0.5,
    },
  }
}

function fairSuite(overrides = {}) {
  const values = {
    normal192: scoreReport({ benchmarkId: "semantic-state-audit-v2-192", total: 192, mode: "normal", runId: "normal-192" }),
    rlm192: scoreReport({ benchmarkId: "semantic-state-audit-v2-192", total: 192, mode: "rlm", runId: "rlm-192" }),
    normal384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "normal", runId: "normal-384" }),
    rlm384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "rlm", runId: "rlm-384" }),
  }
  return { ...values, ...overrides }
}

test("suite binds all four 192/384 arms to one source, model, task and config", () => {
  const suite = compareSemanticStateAuditSuite(fairSuite())
  assert.equal(suite.schema_version, 2)
  assert.equal(suite.kind, "rlm_ab_suite")
  assert.equal(suite.suite_id, "semantic-state-audit-192-384")
  assert.equal(suite.source_commit, SOURCE_COMMIT)
  assert.equal(suite.task_prompt_sha256, TASK_HASH)
  assert.equal(suite.experiment_config_sha256, CONFIG_HASH)
  assert.deepEqual(suite.model, MODEL)
  assert.equal(suite.comparisons.benchmark_192.benchmark_id, "semantic-state-audit-v2-192")
  assert.equal(suite.comparisons.benchmark_384.benchmark_id, "semantic-state-audit-v3-384")
})

test("suite rejects a different source revision on the 384 pair", () => {
  const otherCommit = "f".repeat(40)
  assert.throws(
    () => compareSemanticStateAuditSuite(fairSuite({
      normal384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "normal", runId: "normal-384", sourceCommit: otherCommit }),
      rlm384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "rlm", runId: "rlm-384", sourceCommit: otherCommit }),
    })),
    /suite source_commit mismatch/,
  )
})

test("suite rejects cross-size experiment-config and root-model drift", () => {
  const otherConfig = "f".repeat(64)
  assert.throws(
    () => compareSemanticStateAuditSuite(fairSuite({
      normal384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "normal", runId: "normal-384", configHash: otherConfig }),
      rlm384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "rlm", runId: "rlm-384", configHash: otherConfig }),
    })),
    /suite experiment config mismatch/,
  )

  const otherModel = { ...MODEL, model_id: "other-model" }
  assert.throws(
    () => compareSemanticStateAuditSuite(fairSuite({
      normal384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "normal", runId: "normal-384", model: otherModel }),
      rlm384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "rlm", runId: "rlm-384", model: otherModel }),
    })),
    /suite root model\/variant mismatch/,
  )
})

test("suite rejects wrong corpus size and reused run identities", () => {
  assert.throws(
    () => compareSemanticStateAuditSuite(fairSuite({
      normal192: scoreReport({ benchmarkId: "semantic-state-audit-v2-192", total: 191, mode: "normal", runId: "normal-192" }),
    })),
    /192 normal score must contain exactly 192 benchmark cases/,
  )

  assert.throws(
    () => compareSemanticStateAuditSuite(fairSuite({
      rlm384: scoreReport({ benchmarkId: "semantic-state-audit-v3-384", total: 384, mode: "rlm", runId: "normal-192" }),
    })),
    /four distinct run_id values/,
  )
})
