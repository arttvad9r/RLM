# RLM benchmarks

This directory contains standalone, deterministic evaluation assets for the OpenCode RLM runtime. It does not depend on Autopilot Planner contracts or Autopilot behavioral suites.

## Semantic-state audit

The benchmark family tests one invariant: observable business/domain/UI result state must not be changed before a successful awaited backend/worker operation completes.

The frozen corpora are under `corpora/`, ground truth under `ground-truth/`, benchmark identity manifests under `manifests/`, and the canonical task prompt under `tasks/semantic-state-audit.md`.

The three corpus sizes are:

- v1: 96 TypeScript files, seed `20260815`;
- v2: 192 TypeScript files, seed `20260816`;
- v3: 384 TypeScript files, seed `20260817`.

## Regeneration and integrity

Regenerate deterministically:

```sh
node benchmarks/generator/generate-semantic-state-audit.mjs
node benchmarks/generator/generate-semantic-state-audit-v2.mjs
node benchmarks/generator/generate-semantic-state-audit-v3.mjs
```

Verify the frozen benchmark identity:

```sh
npm run verify:benchmarks
```

The verification scripts bind generator source, ground truth, corpus aggregate and expected generated file count to the manifests.

## Run records

`harness/score-run.mjs` scores a supplied execution record against a frozen corpus, manifest, task prompt and ground truth. `harness/compare-runs.mjs` compares scored normal and RLM runs only when their benchmark identity and experiment invariants are compatible.

Run records can carry root/child token usage, RLM context/call telemetry, cost and wall time. The harness is an evaluator; it deliberately does not embed a particular model provider or downstream project runtime.

Example scoring shape:

```sh
node benchmarks/harness/score-run.mjs \
  --ground-truth benchmarks/ground-truth/semantic-state-audit-v1.json \
  --manifest benchmarks/manifests/semantic-state-audit-v1.json \
  --corpus benchmarks/corpora/semantic-state-audit-v1 \
  --task-prompt benchmarks/tasks/semantic-state-audit.md \
  --run /path/to/run.json \
  --out /path/to/score.json
```

Compare two scored runs:

```sh
node benchmarks/harness/compare-runs.mjs \
  --normal /path/to/normal.score.json \
  --rlm /path/to/rlm.score.json \
  --out /path/to/comparison.json
```

## Isolation rules

- Models must never receive benchmark ground truth or manifests as runtime context.
- Standalone RLM runs must set the trusted host context root to the exact corpus workspace. Keeping ground truth merely in a sibling directory is not an isolation boundary.
- Corpus, task prompt and benchmark identity must remain unchanged across A/B arms.
- Downstream integrations may build their own A/B runners around this harness, but project-specific Planner/Worker contracts do not belong in this standalone tree.
