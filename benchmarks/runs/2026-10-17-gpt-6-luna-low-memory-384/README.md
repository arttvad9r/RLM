# GPT-6 Luna low — turn-memory scaling experiment

Date: 2026-10-17

Corpus: `semantic-state-audit-v3-384` (384 files, 48 violations)

Model: `openai/gpt-6-luna#low`

This exploratory benchmark tests whether turn-scoped RLM working memory helps a semantic audit span more than one `rlm_exec` without returning intermediate candidate lists through the root conversation. Ground truth stays outside the model workspace and is used only after inference for scoring.

The production RLM runtime is unchanged. A benchmark-only helper is injected into a temporary package snapshot so model-generated Code Mode JavaScript does not become an extra variable.

- **single:** one `rlm_exec`, four child calls over the complete corpus.
- **memory:** two partition `rlm_exec` calls with four children each, storing candidate arrays in turn memory, followed by a third `rlm_exec` that merges the stored arrays.
- **repeated series:** three runs per arm with pair order `single→memory`, `memory→single`, `single→memory`.

## Repeated results

| Metric | Single median | Memory median | Memory − Single |
| --- | ---: | ---: | ---: |
| F1 | 0.8627 | 0.8409 | -0.0218 |
| Precision | 0.8409 | 0.8837 | +0.0428 |
| Recall | 0.8542 | 0.7917 | -0.0625 |
| TP | 41 | 38 | -3 |
| FP | 7 | 5 | -2 |
| FN | 7 | 10 | +3 |
| Root logical tokens | 15,408 | 15,368 | -40 (-0.3%) |
| Child logical tokens | 30,995 | 31,735 | +740 (+2.4%) |
| Total logical tokens | 46,403 | 47,103 | +700 (+1.5%) |
| Wall time | 17.25 s | 21.66 s | +4.41 s (+25.6%) |

Token counts are **cache-inclusive logical tokens**: cache-read tokens are counted for both root and child sessions. This matters because one repeated single run reused about 30k child prompt tokens through the provider cache; comparing only uncached input/output would make that arm look artificially cheap.

Observed F1 ranges were `0.8043–0.8817` for single and `0.8352–0.8776` for memory. Memory won F1 in pair 1, was nearly tied in pair 2, and lost in pair 3. The median result therefore does not support a claim that working memory improves quality on this 384-file task.

## Interpretation

The experiment confirms the **mechanical capability** we wanted: turn memory lets one logical analysis span multiple isolated `rlm_exec` executions and eight child calls while keeping root logical-token use essentially flat. Intermediate candidate arrays remain outside the root conversation and are merged later through `memory.get()`.

It does **not** show an efficiency win on this workload. Compared with the one-exec/four-child strategy, the memory strategy used about 1.5% more logical tokens and 25.6% more wall time. It shifted the quality profile toward higher precision but lower recall, producing slightly lower median F1.

The likely conclusion is that working memory is infrastructure for workloads that genuinely require multi-stage or over-budget analysis; it should not be used automatically when a single exhaustive `rlm_exec` already fits the task.

## Evidence

- `repeated-comparison.json` contains all six successful runs, per-run quality/usage data, pair order, medians, ranges and corrected cache-inclusive accounting.
- `comparison.json` is the earlier one-pair exploratory run and should not be treated as the primary result.
- `scripts/live-memory-benchmark.mjs` is the reproducible live runner.

There were no failed attempts in the final six-run repeated series. Three runs per arm reduce but do not eliminate GPT-6 Luna low stochastic variance.
