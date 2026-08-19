import { compareScores } from "./lib.mjs"

const EXPECTED_BENCHMARKS = Object.freeze({
  192: "semantic-state-audit-v2-192",
  384: "semantic-state-audit-v3-384",
})

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function sameModel(a, b) {
  return a.provider_id === b.provider_id
    && a.model_id === b.model_id
    && (a.variant ?? null) === (b.variant ?? null)
}

function requireExpectedPair(normal, rlm, comparison, size) {
  const expectedBenchmark = EXPECTED_BENCHMARKS[size]
  invariant(comparison.benchmark_id === expectedBenchmark, `${size} pair benchmark_id must be ${expectedBenchmark}`)
  invariant(normal.counts.total === size, `${size} normal score must contain exactly ${size} benchmark cases`)
  invariant(rlm.counts.total === size, `${size} rlm score must contain exactly ${size} benchmark cases`)
}

export function compareSemanticStateAuditSuite({ normal192, rlm192, normal384, rlm384 }) {
  const comparison192 = compareScores(normal192, rlm192)
  const comparison384 = compareScores(normal384, rlm384)
  requireExpectedPair(normal192, rlm192, comparison192, 192)
  requireExpectedPair(normal384, rlm384, comparison384, 384)

  invariant(comparison192.source_commit === comparison384.source_commit, "suite source_commit mismatch between 192 and 384 pairs")
  invariant(comparison192.task_prompt_sha256 === comparison384.task_prompt_sha256, "suite task prompt mismatch between 192 and 384 pairs")
  invariant(comparison192.experiment_config_sha256 === comparison384.experiment_config_sha256, "suite experiment config mismatch between 192 and 384 pairs")
  invariant(sameModel(comparison192.model, comparison384.model), "suite root model/variant mismatch between 192 and 384 pairs")

  const scores = [normal192, rlm192, normal384, rlm384]
  const runIds = scores.map((score) => score.run.run_id)
  invariant(new Set(runIds).size === runIds.length, "suite requires four distinct run_id values")
  const runHashes = scores.map((score) => score.integrity.run_sha256)
  invariant(new Set(runHashes).size === runHashes.length, "suite requires four distinct run_sha256 values")

  return {
    schema_version: 2,
    kind: "rlm_ab_suite",
    suite_id: "semantic-state-audit-192-384",
    source_commit: comparison192.source_commit,
    task_prompt_sha256: comparison192.task_prompt_sha256,
    experiment_config_sha256: comparison192.experiment_config_sha256,
    model: comparison192.model,
    runs: {
      normal_192: { run_id: normal192.run.run_id, run_sha256: normal192.integrity.run_sha256 },
      rlm_192: { run_id: rlm192.run.run_id, run_sha256: rlm192.integrity.run_sha256 },
      normal_384: { run_id: normal384.run.run_id, run_sha256: normal384.integrity.run_sha256 },
      rlm_384: { run_id: rlm384.run.run_id, run_sha256: rlm384.integrity.run_sha256 },
    },
    integrity: {
      task_prompt_sha256: comparison192.integrity.task_prompt_sha256,
      experiment_config_sha256: comparison192.integrity.experiment_config_sha256,
      benchmark_192: {
        ground_truth_sha256: comparison192.integrity.ground_truth_sha256,
        corpus_aggregate_sha256: comparison192.integrity.corpus_aggregate_sha256,
      },
      benchmark_384: {
        ground_truth_sha256: comparison384.integrity.ground_truth_sha256,
        corpus_aggregate_sha256: comparison384.integrity.corpus_aggregate_sha256,
      },
    },
    comparisons: {
      benchmark_192: comparison192,
      benchmark_384: comparison384,
    },
  }
}
