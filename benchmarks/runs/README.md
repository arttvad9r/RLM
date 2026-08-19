# RLM benchmark run records

Store durable benchmark inputs and scored reports here. A run input is evidence produced by one completed model run; the scorer never invokes a model and never exposes ground truth during inference.

The canonical semantic-state task prompt is `benchmarks/tasks/semantic-state-audit.md`. Both sides of an A/B pair must use those exact bytes; the scorer computes the hash itself and rejects a run that claims a different prompt hash.

Before inference, create one shared experiment-config file containing every non-mode inference/runtime setting that must remain identical across the A/B pair but is not already captured by `source_commit` and `model` (for example provider generation settings, reasoning controls and root runtime flags). Reuse the exact same file bytes for both arms. The scorer hashes that file and rejects a run whose `experiment_config_sha256` differs.

Required run format:

```json
{
  "schema_version": 1,
  "benchmark_id": "semantic-state-audit-v2-192",
  "run_id": "20260818-normal-01",
  "mode": "normal",
  "source_commit": "0000000000000000000000000000000000000000",
  "task_prompt_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "experiment_config_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "model": { "provider_id": "provider", "model_id": "model", "variant": null },
  "started_at": "2026-08-18T00:00:00Z",
  "finished_at": "2026-08-18T00:00:01Z",
  "predicted_violations": ["src/example.ts"],
  "usage": {
    "wall_ms": 1000,
    "root_input_tokens": 0,
    "root_output_tokens": 0,
    "child_input_tokens": 0,
    "child_output_tokens": 0,
    "cost_usd": null,
    "rlm_exec_count": 0,
    "rlm_child_calls": 0,
    "rlm_context_calls": 0,
    "rlm_context_chars": 0
  }
}
```

For `normal` runs all child/RLM counters must be zero. For RLM runs set `mode` to `rlm`, record aggregate `rlm_exec` metadata, and require `rlm_exec_count > 0`; an arm that merely had RLM available but never invoked it is not valid RLM benchmark evidence. Use the same full source commit, root model/variant, task prompt and shared experiment-config bytes for both sides of an A/B pair.

Score a run against the exact frozen corpus, task-prompt bytes and shared experiment config:

```sh
node benchmarks/harness/score-run.mjs \
  --ground-truth benchmarks/ground-truth/semantic-state-audit-v2-192.json \
  --manifest benchmarks/manifests/semantic-state-audit-v2-192.json \
  --corpus benchmarks/corpora/semantic-state-audit-v2-192 \
  --task-prompt benchmarks/tasks/semantic-state-audit.md \
  --experiment-config /path/to/shared-experiment-config.json \
  --run benchmarks/runs/<run>.json \
  --out benchmarks/runs/<run>.score.json
```

Compare a fair pair:

```sh
node benchmarks/harness/compare-runs.mjs \
  --normal benchmarks/runs/<normal>.score.json \
  --rlm benchmarks/runs/<rlm>.score.json \
  --out benchmarks/runs/<pair>.comparison.json
```

The scorer fails closed on task-prompt hash mismatch, experiment-config hash mismatch, ground-truth hash mismatch, corpus aggregate mismatch, unknown/duplicate prediction paths, invalid usage data, RLM-mode records without observed `rlm_exec`, or malformed run metadata. The comparator rejects pairs with different prompt/config/corpus/ground-truth data, source commit or root model/variant. It reports deltas only; adoption policy remains outside the scorer.
