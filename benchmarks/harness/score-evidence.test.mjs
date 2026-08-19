import assert from "node:assert/strict"
import test from "node:test"
import { compareScores, sha256 } from "./lib.mjs"

const GROUND = "a".repeat(64)
const CORPUS = "b".repeat(64)
const TASK = "c".repeat(64)
const CONFIG = "d".repeat(64)
const COMMIT = "e".repeat(40)

function score(mode, runId) {
  const rlm = mode === "rlm"
  return {
    schema_version: 2,
    kind: "rlm_benchmark_score",
    benchmark_id: "fixture-v1",
    run: {
      run_id: runId,
      mode,
      source_commit: COMMIT,
      task_prompt_sha256: TASK,
      experiment_config_sha256: CONFIG,
      model: { provider_id: "provider", model_id: "model", variant: null },
      started_at: "2026-08-19T12:00:00Z",
      finished_at: "2026-08-19T12:00:01Z",
      usage: {
        wall_ms: 1000,
        root_input_tokens: 1,
        root_output_tokens: 1,
        child_input_tokens: 0,
        child_output_tokens: 0,
        cost_usd: null,
        rlm_exec_count: rlm ? 1 : 0,
        rlm_child_calls: 0,
        rlm_context_calls: 0,
        rlm_context_chars: 0,
        total_tokens: 2,
      },
    },
    integrity: {
      manifest_ground_truth_sha256: GROUND,
      actual_ground_truth_sha256: GROUND,
      manifest_corpus_aggregate_sha256: CORPUS,
      actual_corpus_aggregate_sha256: CORPUS,
      canonical_task_prompt_sha256: TASK,
      canonical_experiment_config_sha256: CONFIG,
      run_sha256: sha256(Buffer.from(`${mode}:${runId}`)),
    },
    counts: { total: 1, expected_violations: 0, predicted_violations: 0, tp: 0, fp: 0, fn: 0, tn: 1 },
    metrics: { violation_precision: 0, violation_recall: 0, violation_f1: 0, specificity: 1, accuracy: 1, balanced_accuracy: 0.5 },
  }
}

test("score comparator rejects malformed or reversed timestamps", () => {
  const rlm = score("rlm", "rlm-1")
  const malformed = score("normal", "normal-malformed")
  malformed.run.started_at = "not-a-date"
  assert.throws(() => compareScores(malformed, rlm), /score started_at must be an ISO-compatible timestamp/)

  const reversed = score("normal", "normal-reversed")
  reversed.run.started_at = "2026-08-19T12:00:02Z"
  reversed.run.finished_at = "2026-08-19T12:00:01Z"
  assert.throws(() => compareScores(reversed, rlm), /score finished_at must not precede started_at/)
})

test("A/B comparator requires distinct run identities", () => {
  assert.throws(
    () => compareScores(score("normal", "same-run"), score("rlm", "same-run")),
    /distinct run_id values/,
  )
})

test("A/B comparator rejects inconsistent ground-truth counts and reused run hashes", () => {
  const normal = score("normal", "normal-counts")
  const rlm = score("rlm", "rlm-counts")
  rlm.counts = { total: 2, expected_violations: 1, predicted_violations: 0, tp: 0, fp: 0, fn: 1, tn: 1 }
  rlm.metrics = { violation_precision: 0, violation_recall: 0, violation_f1: 0, specificity: 1, accuracy: 0.5, balanced_accuracy: 0.5 }
  assert.throws(() => compareScores(normal, rlm), /benchmark case-count mismatch/)

  const normalHash = score("normal", "normal-hash")
  const rlmHash = score("rlm", "rlm-hash")
  rlmHash.integrity.run_sha256 = normalHash.integrity.run_sha256
  assert.throws(() => compareScores(normalHash, rlmHash), /distinct run_sha256 values/)
})
