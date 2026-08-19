import { createHash } from "node:crypto"

const SHA256_RE = /^[a-f0-9]{64}$/
const COMMIT_RE = /^[a-f0-9]{40}$/
const MODES = new Set(["normal", "rlm"])
const USAGE_INT_FIELDS = [
  "wall_ms",
  "root_input_tokens",
  "root_output_tokens",
  "child_input_tokens",
  "child_output_tokens",
  "rlm_exec_count",
  "rlm_child_calls",
  "rlm_context_calls",
  "rlm_context_chars",
]

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

/** Same corpus aggregate used by generator/verify*.mjs: sorted basename + LF + UTF-8 content. */
export function corpusAggregate(entries) {
  const normalized = [...entries]
    .map((entry) => {
      invariant(isRecord(entry), "corpus entry must be an object")
      invariant(typeof entry.name === "string" && entry.name.length > 0, "corpus entry name is required")
      invariant(typeof entry.content === "string", `corpus entry content must be a string: ${entry.name}`)
      return { name: entry.name, content: entry.content }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const seen = new Set()
  const hash = createHash("sha256")
  for (const entry of normalized) {
    invariant(!seen.has(entry.name), `duplicate corpus entry: ${entry.name}`)
    seen.add(entry.name)
    hash.update(entry.name)
    hash.update("\n")
    hash.update(entry.content)
  }
  return hash.digest("hex")
}

export function validateBundle({
  groundTruth,
  manifest,
  run,
  groundTruthSha256,
  corpusAggregateSha256,
  taskPromptSha256,
  experimentConfigSha256,
}) {
  invariant(isRecord(groundTruth), "ground truth must be an object")
  invariant(typeof groundTruth.benchmark === "string" && groundTruth.benchmark.length > 0, "ground truth benchmark is required")
  invariant(Array.isArray(groundTruth.cases) && groundTruth.cases.length > 0, "ground truth cases must be a non-empty array")
  invariant(typeof taskPromptSha256 === "string" && SHA256_RE.test(taskPromptSha256), "task prompt sha256 is invalid")
  invariant(typeof experimentConfigSha256 === "string" && SHA256_RE.test(experimentConfigSha256), "experiment config sha256 is invalid")

  const pathToClass = new Map()
  for (const entry of groundTruth.cases) {
    invariant(isRecord(entry), "ground truth case must be an object")
    invariant(typeof entry.path === "string" && entry.path.length > 0, "ground truth case path is required")
    invariant(["violation", "decoy", "neutral"].includes(entry.class), `invalid ground truth class for ${entry.path}`)
    invariant(!pathToClass.has(entry.path), `duplicate ground truth path: ${entry.path}`)
    pathToClass.set(entry.path, entry.class)
  }

  invariant(isRecord(manifest), "manifest must be an object")
  invariant(manifest.benchmark_id === groundTruth.benchmark, "manifest benchmark_id does not match ground truth")
  invariant(isRecord(manifest.sha256), "manifest sha256 block is required")
  invariant(typeof manifest.sha256.ground_truth === "string" && SHA256_RE.test(manifest.sha256.ground_truth), "manifest ground-truth sha256 is invalid")
  invariant(typeof manifest.sha256.corpus_aggregate === "string" && SHA256_RE.test(manifest.sha256.corpus_aggregate), "manifest corpus aggregate sha256 is invalid")
  invariant(manifest.sha256.ground_truth === groundTruthSha256, "ground truth bytes do not match manifest sha256")
  invariant(manifest.sha256.corpus_aggregate === corpusAggregateSha256, "corpus bytes do not match manifest aggregate sha256")
  invariant(manifest.generated_file_count === groundTruth.cases.length, "manifest file count does not match ground truth")

  validateRun(run, groundTruth.benchmark, pathToClass, taskPromptSha256, experimentConfigSha256)
  return pathToClass
}

export function validateRun(run, benchmarkId, pathToClass, taskPromptSha256, experimentConfigSha256) {
  invariant(isRecord(run), "run must be an object")
  invariant(run.schema_version === 1, "run schema_version must be 1")
  invariant(run.benchmark_id === benchmarkId, "run benchmark_id does not match ground truth")
  invariant(typeof run.run_id === "string" && run.run_id.trim().length > 0, "run_id is required")
  invariant(MODES.has(run.mode), "run mode must be normal or rlm")
  invariant(typeof run.source_commit === "string" && COMMIT_RE.test(run.source_commit), "source_commit must be a full lowercase 40-char SHA")
  invariant(typeof run.task_prompt_sha256 === "string" && SHA256_RE.test(run.task_prompt_sha256), "task_prompt_sha256 must be lowercase sha256")
  invariant(run.task_prompt_sha256 === taskPromptSha256, "run task_prompt_sha256 does not match canonical task prompt")
  invariant(typeof run.experiment_config_sha256 === "string" && SHA256_RE.test(run.experiment_config_sha256), "experiment_config_sha256 must be lowercase sha256")
  invariant(run.experiment_config_sha256 === experimentConfigSha256, "run experiment_config_sha256 does not match shared experiment config")
  invariant(isRecord(run.model), "model block is required")
  invariant(typeof run.model.provider_id === "string" && run.model.provider_id.length > 0, "model.provider_id is required")
  invariant(typeof run.model.model_id === "string" && run.model.model_id.length > 0, "model.model_id is required")
  invariant(run.model.variant === null || run.model.variant === undefined || typeof run.model.variant === "string", "model.variant must be string or null")
  invariant(typeof run.started_at === "string" && Number.isFinite(Date.parse(run.started_at)), "started_at must be an ISO-compatible timestamp")
  invariant(typeof run.finished_at === "string" && Number.isFinite(Date.parse(run.finished_at)), "finished_at must be an ISO-compatible timestamp")
  invariant(Date.parse(run.finished_at) >= Date.parse(run.started_at), "finished_at must not precede started_at")

  invariant(Array.isArray(run.predicted_violations), "predicted_violations must be an array")
  const predicted = new Set()
  for (const path of run.predicted_violations) {
    invariant(typeof path === "string" && path.length > 0, "predicted violation paths must be non-empty strings")
    invariant(!predicted.has(path), `duplicate predicted path: ${path}`)
    invariant(pathToClass.has(path), `predicted path is not in benchmark: ${path}`)
    predicted.add(path)
  }

  invariant(isRecord(run.usage), "usage block is required")
  for (const field of USAGE_INT_FIELDS) {
    invariant(Number.isInteger(run.usage[field]) && run.usage[field] >= 0, `usage.${field} must be a non-negative integer`)
  }
  invariant(
    run.usage.cost_usd === null || (typeof run.usage.cost_usd === "number" && Number.isFinite(run.usage.cost_usd) && run.usage.cost_usd >= 0),
    "usage.cost_usd must be null or a non-negative finite number",
  )

  if (run.mode === "normal") {
    for (const field of ["child_input_tokens", "child_output_tokens", "rlm_exec_count", "rlm_child_calls", "rlm_context_calls", "rlm_context_chars"]) {
      invariant(run.usage[field] === 0, `normal run must have usage.${field}=0`)
    }
  } else {
    invariant(run.usage.rlm_exec_count > 0, "rlm run must have usage.rlm_exec_count > 0")
  }
}

export function scoreRun({
  groundTruth,
  manifest,
  run,
  groundTruthSha256,
  corpusAggregateSha256,
  taskPromptSha256,
  experimentConfigSha256,
  runSha256,
}) {
  const pathToClass = validateBundle({
    groundTruth,
    manifest,
    run,
    groundTruthSha256,
    corpusAggregateSha256,
    taskPromptSha256,
    experimentConfigSha256,
  })
  const positives = new Set([...pathToClass.entries()].filter(([, cls]) => cls === "violation").map(([path]) => path))
  const predicted = new Set(run.predicted_violations)

  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  for (const path of pathToClass.keys()) {
    const expected = positives.has(path)
    const actual = predicted.has(path)
    if (expected && actual) tp++
    else if (!expected && actual) fp++
    else if (expected) fn++
    else tn++
  }

  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, tp + fn)
  const specificity = ratio(tn, tn + fp)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  const accuracy = ratio(tp + tn, pathToClass.size)
  const balancedAccuracy = (recall + specificity) / 2
  const totalTokens = run.usage.root_input_tokens + run.usage.root_output_tokens + run.usage.child_input_tokens + run.usage.child_output_tokens

  return {
    schema_version: 1,
    kind: "rlm_benchmark_score",
    benchmark_id: groundTruth.benchmark,
    run: {
      run_id: run.run_id,
      mode: run.mode,
      source_commit: run.source_commit,
      task_prompt_sha256: run.task_prompt_sha256,
      experiment_config_sha256: run.experiment_config_sha256,
      model: run.model,
      started_at: run.started_at,
      finished_at: run.finished_at,
      usage: { ...run.usage, total_tokens: totalTokens },
    },
    integrity: {
      manifest_ground_truth_sha256: manifest.sha256.ground_truth,
      actual_ground_truth_sha256: groundTruthSha256,
      manifest_corpus_aggregate_sha256: manifest.sha256.corpus_aggregate,
      actual_corpus_aggregate_sha256: corpusAggregateSha256,
      canonical_task_prompt_sha256: taskPromptSha256,
      canonical_experiment_config_sha256: experimentConfigSha256,
      run_sha256: runSha256,
    },
    counts: {
      total: pathToClass.size,
      expected_violations: positives.size,
      predicted_violations: predicted.size,
      tp,
      fp,
      fn,
      tn,
    },
    metrics: {
      violation_precision: round6(precision),
      violation_recall: round6(recall),
      violation_f1: round6(f1),
      specificity: round6(specificity),
      accuracy: round6(accuracy),
      balanced_accuracy: round6(balancedAccuracy),
    },
  }
}

function sameModel(a, b) {
  return a.provider_id === b.provider_id && a.model_id === b.model_id && (a.variant ?? null) === (b.variant ?? null)
}

export function compareScores(normal, rlm) {
  invariant(normal?.kind === "rlm_benchmark_score" && rlm?.kind === "rlm_benchmark_score", "inputs must be scored benchmark reports")
  invariant(normal.run?.mode === "normal", "normal report must have mode=normal")
  invariant(rlm.run?.mode === "rlm", "rlm report must have mode=rlm")
  invariant(normal.benchmark_id === rlm.benchmark_id, "benchmark_id mismatch")
  invariant(normal.integrity?.actual_ground_truth_sha256 === rlm.integrity?.actual_ground_truth_sha256, "ground-truth hash mismatch")
  invariant(normal.integrity?.actual_corpus_aggregate_sha256 === rlm.integrity?.actual_corpus_aggregate_sha256, "corpus aggregate hash mismatch")
  invariant(normal.integrity?.canonical_task_prompt_sha256 === rlm.integrity?.canonical_task_prompt_sha256, "canonical task prompt hash mismatch")
  invariant(normal.integrity?.canonical_experiment_config_sha256 === rlm.integrity?.canonical_experiment_config_sha256, "experiment config hash mismatch")
  invariant(normal.run.source_commit === rlm.run.source_commit, "source_commit mismatch")
  invariant(normal.run.task_prompt_sha256 === rlm.run.task_prompt_sha256, "task prompt mismatch")
  invariant(normal.run.experiment_config_sha256 === rlm.run.experiment_config_sha256, "experiment config mismatch")
  invariant(sameModel(normal.run.model, rlm.run.model), "root model/variant mismatch")

  const delta = (field) => round6(rlm.metrics[field] - normal.metrics[field])
  const costDelta = normal.run.usage.cost_usd === null || rlm.run.usage.cost_usd === null
    ? null
    : round6(rlm.run.usage.cost_usd - normal.run.usage.cost_usd)

  return {
    schema_version: 1,
    kind: "rlm_ab_comparison",
    benchmark_id: normal.benchmark_id,
    source_commit: normal.run.source_commit,
    task_prompt_sha256: normal.run.task_prompt_sha256,
    experiment_config_sha256: normal.run.experiment_config_sha256,
    model: normal.run.model,
    integrity: {
      ground_truth_sha256: normal.integrity.actual_ground_truth_sha256,
      corpus_aggregate_sha256: normal.integrity.actual_corpus_aggregate_sha256,
      task_prompt_sha256: normal.integrity.canonical_task_prompt_sha256,
      experiment_config_sha256: normal.integrity.canonical_experiment_config_sha256,
    },
    runs: { normal: normal.run.run_id, rlm: rlm.run.run_id },
    quality: {
      normal: normal.metrics,
      rlm: rlm.metrics,
      rlm_minus_normal: {
        violation_precision: delta("violation_precision"),
        violation_recall: delta("violation_recall"),
        violation_f1: delta("violation_f1"),
        specificity: delta("specificity"),
        accuracy: delta("accuracy"),
        balanced_accuracy: delta("balanced_accuracy"),
      },
    },
    efficiency: {
      normal: {
        wall_ms: normal.run.usage.wall_ms,
        total_tokens: normal.run.usage.total_tokens,
        cost_usd: normal.run.usage.cost_usd,
      },
      rlm: {
        wall_ms: rlm.run.usage.wall_ms,
        total_tokens: rlm.run.usage.total_tokens,
        cost_usd: rlm.run.usage.cost_usd,
      },
      rlm_minus_normal: {
        wall_ms: rlm.run.usage.wall_ms - normal.run.usage.wall_ms,
        total_tokens: rlm.run.usage.total_tokens - normal.run.usage.total_tokens,
        cost_usd: costDelta,
      },
    },
  }
}

export function parseArgs(argv, required) {
  invariant(argv.length % 2 === 0, "arguments must be --key value pairs")
  const result = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    invariant(key?.startsWith("--") && value !== undefined, `invalid argument sequence near ${key ?? "<end>"}`)
    invariant(!(key.slice(2) in result), `duplicate argument ${key}`)
    result[key.slice(2)] = value
  }
  for (const key of required) invariant(typeof result[key] === "string", `missing --${key}`)
  return result
}
