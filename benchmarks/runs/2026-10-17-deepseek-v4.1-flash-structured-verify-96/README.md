# DeepSeek V4.1 Flash production structured verification — 96 files

This directory intentionally retains both successful and unsuccessful development evidence for `rlm_verify`. The corpus is the frozen 96-file `semantic-state-audit-v1` benchmark with 12 true violations. Do not interpret the best run in isolation.

The production quality question is asymmetric: given a first-stage candidate set, can verification remove false positives without deleting true positives? Later reports therefore use paired scoring against the exact same `rlm_map(path_list)` candidate array.

## Evidence chronology

| Evidence | Design | Main result |
| --- | --- | --- |
| `production-verification.json` | Early production experiments with separate scan/verify arms. Scan-only arms are not a fair A/B against independently sampled verify arms; pre/post quality inside each verify arm remains informative. | One verify run reached F1 1.0, but two runs removed 2 true positives each and reduced recall to 0.8333. |
| `paired-production-verification-pre-hardening.json` | Exact paired candidate set, before the later proof-rule prompt hardening. | Three accepted samples happened to remove 0 true positives; median verified F1 1.0. This did not establish reliability because other retained runs had already shown recall failures. |
| `paired-production-verification-prompt-only.json` | Exact paired candidate set after prompt proof-rule hardening, still single-pass removal. | Two rounds were perfect, but one round removed 5 true positives and fell to F1 0.5833. This is the direct evidence that prompt hardening alone was insufficient. |
| `paired-production-verification-pre-stage-metrics.json` | Two-pass implementation before per-stage latency/cost isolation. Exact paired candidate set; free GLM root trigger; DeepSeek V4.1 Flash semantic children. | Three accepted rounds removed 0 true positives. Median F1 0.8889 -> 0.9231. Retained because later reruns show substantial model variance. |
| `paired-production-verification.json` | Current two-pass implementation with exact paired candidates and isolated `rlm_map` / `rlm_verify` stage telemetry. | Three accepted rounds removed 0 true positives. Verification improved one round and was neutral in two; median F1 0.8276 -> 0.8276, recall stayed 1.0000. Median verifier overhead: 15.625 s and $0.005257 child-provider cost. |

The current report has no discarded attempts. Across its three accepted rounds, verifier child cost totals `$0.014666` and end-to-end provider-reported cost totals about `$0.043807`. The earlier two-pass sample is preserved rather than replaced because its stronger result and the current neutral median together show that a three-run semantic sample is still noisy.

## Current design

The benchmark snapshot injects a benchmark-only wrapper that calls the real production `executeRlmMap` and `executeRlmVerify` functions with fixed inputs. This avoids asking the root model to author map/verify glue while preserving the actual OpenCode host adapter, zero-permission sandbox, turn governor, child scheduler, fixed child routing and deny-all semantic child isolation. The root model is `opencode/glm-5.3-flash-free`; semantic children are `ollama-cloud/deepseek-v4.1-flash`.

The wrapper measures each production stage directly around its executor call and also records the stage's canonical telemetry. The report cross-checks stage child-call counts against the structured contracts and the summed stage child cost against the captured descendant-session cost before accepting a round. `pipeline_wall_ms` and total session cost remain available separately so verifier overhead is not confused with the shared scan or root trigger.

`rlm_verify` is remove-only and candidates are presumptively valid. A first pass may nominate removals; a second independent pass sees only those provisional removals and must confirm them. Failure or uncertainty means KEEP. This lowers observed false-removal risk, but same-model confirmation can still be correlated. More corpora/providers/repetitions are required before broader claims.

## Reproduce the current paired run

From the repository root, with OpenCode/Ollama Cloud authentication already configured:

```bash
RLM_LIVE_OPENCODE_MODEL=ollama-cloud/deepseek-v4.1-flash \
RLM_VERIFY_BENCH_ROOT_MODEL=opencode/glm-5.3-flash-free \
RLM_VERIFY_BENCH_REPEATS=3 \
RLM_VERIFY_BENCH_WRITE=1 \
node scripts/live-structured-verify-benchmark.mjs
```

The runner temporarily installs an isolated plugin snapshot and, when root/child models differ, temporarily writes the trusted fixed-child routing policy. Its `finally` path removes the plugin/sessions and restores or removes the host config. External provider/Code Mode failures are recorded separately from accepted semantic runs.
