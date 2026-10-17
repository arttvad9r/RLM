# GPT-6 Luna low — single-exec fan-out scaling

Date: 2026-10-17

Corpus: `semantic-state-audit-v3-384` (384 TypeScript files, 48 violations; about 75 KiB)

Model: `openai/gpt-6-luna#low`

This exploratory experiment measures semantic fan-out inside **one `rlm_exec`** after the runtime separated total child calls from active concurrency. A benchmark-only fixed orchestration helper divides the same 384-file corpus round-robin into 4, 8 or 16 semantic partitions. The production concurrency ceiling remains 4, so fan-outs above 4 are queued by the host scheduler rather than run simultaneously.

Each fan-out ran three times in balanced order:

```text
4 -> 8 -> 16
8 -> 16 -> 4
16 -> 4 -> 8
```

All runs used a fresh root session. Ground truth remained outside the model workspace and was used only after inference for scoring. Logical token totals include cache-read tokens for both root and child sessions.

## Median results

| Metric | 4 children | 8 children | 16 children |
| --- | ---: | ---: | ---: |
| F1 | 0.8172 | 0.8119 | **0.8400** |
| Precision | **0.8444** | 0.7736 | 0.8077 |
| Recall | 0.7917 | 0.8542 | **0.8958** |
| Root logical tokens | **15,418** | 15,566 | 15,562 |
| Child logical tokens | **30,994** | 31,808 | 33,318 |
| Total logical tokens | **46,412** | 47,374 | 48,880 |
| Wall time | 21.03 s | **20.84 s** | 26.13 s |

F1 ranges across the three runs were:

- 4 children: `0.7917–0.8791`
- 8 children: `0.7921–0.8454`
- 16 children: `0.8190–0.8713`

Relative to 4 children, the 8-child median used about **2.1%** more total logical tokens and did not improve median F1. The 16-child median used about **5.3%** more total logical tokens and about **24.2%** more wall time, while increasing recall by **10.4 percentage points** and median F1 by about **0.0228**. Precision fell by about **3.7 percentage points**.

## Interpretation

More partitions primarily improved **coverage**, not precision. On this corpus, 16 children found more true violations consistently enough to produce the best median recall and F1, but the quality gain is modest and stochastic variation remains large. Eight children were not a useful middle point in this three-run sample.

The root logical-token count remained almost flat as fan-out increased; most of the extra cost was child inference. This is the expected RLM scaling shape: the root delegates more narrowly partitioned semantic work without proportionally increasing its own context load.

The result does **not** justify making 16 children mandatory for every task. Fan-out should remain a bounded strategy choice. Smaller tasks may prefer fewer children for latency/cost, while coverage-oriented repository audits may benefit from more partitions.

This benchmark does not test turn-scoped working memory or multi-stage reasoning. All three arms use exactly one `rlm_exec`; memory should be evaluated separately only on tasks whose later stage depends on earlier intermediate state.

## Caveats

- Three runs per fan-out reduce but do not eliminate Luna-low variance.
- The corpus is small compared with the long-context regimes motivating RLM research.
- The fixed helper measures the runtime/decomposition strategy, not the model's ability to generate valid orchestration JavaScript.
- Wall-time differences below the large 16-child increase should not be treated as stable performance claims from only three runs.

Raw run evidence and full distributions are in `scaling.json`.