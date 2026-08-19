import assert from "node:assert/strict"
import test from "node:test"
import { compareScores, corpusAggregate, scoreRun, sha256 } from "./lib.mjs"

const groundTruth = {
  benchmark: "fixture-v1",
  cases: [
    { path: "src/a.ts", class: "violation" },
    { path: "src/b.ts", class: "violation" },
    { path: "src/c.ts", class: "decoy" },
    { path: "src/d.ts", class: "neutral" },
  ],
}
const groundTruthBytes = Buffer.from(JSON.stringify(groundTruth))
const groundTruthSha256 = sha256(groundTruthBytes)
const taskPromptBytes = Buffer.from("canonical task\n")
const taskPromptSha256 = sha256(taskPromptBytes)
const corpusEntries = [
  { name: "d.ts", content: "D" },
  { name: "b.ts", content: "B" },
  { name: "a.ts", content: "A" },
  { name: "c.ts", content: "C" },
]
const corpusAggregateSha256 = corpusAggregate(corpusEntries)
const manifest = {
  benchmark_id: "fixture-v1",
  generated_file_count: 4,
  sha256: { ground_truth: groundTruthSha256, corpus_aggregate: corpusAggregateSha256 },
}
const baseRun = {
  schema_version: 1,
  benchmark_id: "fixture-v1",
  run_id: "normal-1",
  mode: "normal",
  source_commit: "a".repeat(40),
  task_prompt_sha256: taskPromptSha256,
  model: { provider_id: "provider", model_id: "model", variant: "high" },
  started_at: "2026-08-18T12:00:00Z",
  finished_at: "2026-08-18T12:00:01Z",
  predicted_violations: ["src/a.ts", "src/c.ts"],
  usage: {
    wall_ms: 1000,
    root_input_tokens: 100,
    root_output_tokens: 50,
    child_input_tokens: 0,
    child_output_tokens: 0,
    cost_usd: 0.01,
    rlm_exec_count: 0,
    rlm_child_calls: 0,
    rlm_context_calls: 0,
    rlm_context_chars: 0,
  },
}

function score(run, corpusHash = corpusAggregateSha256, promptHash = taskPromptSha256) {
  const runBytes = Buffer.from(JSON.stringify(run))
  return scoreRun({ groundTruth, manifest, run, groundTruthSha256, corpusAggregateSha256: corpusHash, taskPromptSha256: promptHash, runSha256: sha256(runBytes) })
}

test("corpus aggregate matches verifier ordering independent of input order", () => {
  const sorted = corpusAggregate([...corpusEntries].sort((a, b) => a.name.localeCompare(b.name)))
  assert.equal(corpusAggregateSha256, sorted)
})

test("scores binary violation detection deterministically", () => {
  const report = score(baseRun)
  assert.deepEqual(report.counts, {
    total: 4,
    expected_violations: 2,
    predicted_violations: 2,
    tp: 1,
    fp: 1,
    fn: 1,
    tn: 1,
  })
  assert.equal(report.metrics.violation_precision, 0.5)
  assert.equal(report.metrics.violation_recall, 0.5)
  assert.equal(report.metrics.violation_f1, 0.5)
  assert.equal(report.metrics.accuracy, 0.5)
})

test("rejects predictions outside the frozen benchmark", () => {
  assert.throws(() => score({ ...baseRun, predicted_violations: ["src/missing.ts"] }), /not in benchmark/)
})

test("rejects scoring when corpus bytes differ from the manifest", () => {
  assert.throws(() => score(baseRun, "f".repeat(64)), /corpus bytes do not match/)
})

test("rejects scoring when run prompt hash is not canonical", () => {
  assert.throws(() => score({ ...baseRun, task_prompt_sha256: "f".repeat(64) }), /does not match canonical task prompt/)
})

test("rejects rlm mode without observed rlm_exec usage", () => {
  assert.throws(
    () => score({ ...baseRun, run_id: "rlm-zero", mode: "rlm" }),
    /rlm run must have usage\.rlm_exec_count > 0/,
  )
})

test("compares only fair normal-vs-rlm runs", () => {
  const normal = score(baseRun)
  const rlm = score({
    ...baseRun,
    run_id: "rlm-1",
    mode: "rlm",
    predicted_violations: ["src/a.ts", "src/b.ts"],
    usage: {
      wall_ms: 1500,
      root_input_tokens: 80,
      root_output_tokens: 40,
      child_input_tokens: 60,
      child_output_tokens: 20,
      cost_usd: 0.015,
      rlm_exec_count: 1,
      rlm_child_calls: 2,
      rlm_context_calls: 4,
      rlm_context_chars: 1000,
    },
  })
  const comparison = compareScores(normal, rlm)
  assert.equal(comparison.quality.rlm_minus_normal.violation_f1, 0.5)
  assert.equal(comparison.efficiency.rlm_minus_normal.total_tokens, 50)
  assert.equal(comparison.efficiency.rlm_minus_normal.wall_ms, 500)
  assert.equal(comparison.integrity.corpus_aggregate_sha256, corpusAggregateSha256)
  assert.equal(comparison.integrity.task_prompt_sha256, taskPromptSha256)
})

test("rejects A/B comparison when root model differs", () => {
  const normal = score(baseRun)
  const rlm = score({
    ...baseRun,
    run_id: "rlm-2",
    mode: "rlm",
    model: { ...baseRun.model, model_id: "other" },
    usage: {
      ...baseRun.usage,
      child_input_tokens: 1,
      rlm_exec_count: 1,
      rlm_child_calls: 1,
    },
  })
  assert.throws(() => compareScores(normal, rlm), /model\/variant mismatch/)
})
