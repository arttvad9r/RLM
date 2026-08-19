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

The hardened run/score/comparison evidence contract is schema version 2. `harness/score-run.mjs` scores a supplied execution record against a frozen corpus, manifest, task prompt, shared experiment configuration and ground truth. `harness/compare-runs.mjs` compares scored normal and RLM runs only when their benchmark identity and experiment invariants are compatible.

Before inference, freeze one shared experiment-config file containing every non-mode inference/runtime setting that is not already represented by the source revision and root model identity. Both arms must use the exact same bytes. The scorer binds each run to that file's SHA-256 and the comparator rejects mismatched configuration identities.

Run records can carry root/child token usage, RLM context/call telemetry, cost and wall time. An RLM-mode run must record at least one observed `rlm_exec`; merely making the tool available is not RLM execution evidence. The harness is an evaluator; it deliberately does not embed a particular model provider or downstream project runtime.

Example scoring shape:

```sh
node benchmarks/harness/score-run.mjs \
  --ground-truth benchmarks/ground-truth/semantic-state-audit-v1.json \
  --manifest benchmarks/manifests/semantic-state-audit-v1.json \
  --corpus benchmarks/corpora/semantic-state-audit-v1 \
  --task-prompt benchmarks/tasks/semantic-state-audit.md \
  --experiment-config /path/to/shared-experiment-config.json \
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

For the 192/384 acceptance suite, bind all four scored arms into one evidence record after the two pairs have been scored:

```sh
node benchmarks/harness/compare-suite.mjs \
  --192-normal /path/to/192-normal.score.json \
  --192-rlm /path/to/192-rlm.score.json \
  --384-normal /path/to/384-normal.score.json \
  --384-rlm /path/to/384-rlm.score.json \
  --out /path/to/semantic-state-audit-192-384.suite.json
```

The suite comparator reruns the pair-level validation, requires the expected 192 and 384 benchmark identities/counts, requires four distinct run IDs/content hashes, and rejects any cross-size drift in source commit, task prompt, experiment configuration or root model/variant. This prevents two individually fair A/B pairs from being combined into a nominal 192/384 result when they were actually executed under different root conditions.

## Isolation rules

- Models must never receive benchmark ground truth or manifests as runtime context.
- Standalone RLM runs must set the trusted host context root to the exact corpus workspace. Keeping ground truth merely in a sibling directory is not an isolation boundary.
- Corpus, task prompt, source revision, root model/variant and shared experiment-config bytes must remain unchanged across A/B arms; only RLM availability/use may differ.
- The 192 and 384 pairs in the acceptance suite must also share source revision, root model/variant, task prompt and experiment-config identity; persist the `compare-suite.mjs` output as the four-arm evidence record.
- Downstream integrations may build their own A/B runners around this harness, but project-specific Planner/Worker contracts do not belong in this standalone tree.
