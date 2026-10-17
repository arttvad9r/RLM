# GPT-6 Sol low child-routing benchmark — 384 files

Date: 2026-10-17

This exploratory benchmark compares three ways to audit the same frozen 384-file semantic-state corpus with `openai/gpt-6-sol#low` as the root model. Each arm has three runs in balanced order. Both RLM arms use one fixed 16-way orchestration pass with a host concurrency ceiling of four.

## Arms

- **Direct:** Sol low root analyzes the complete corpus with ordinary root tools; no RLM children.
- **Sol children:** Sol low root uses one `rlm_exec`; all 16 semantic children inherit `openai/gpt-6-sol#low`.
- **Luna children:** Sol low root uses the identical `rlm_exec`; trusted host config fixes all 16 children to `openai/gpt-6-luna#low`.

## Median results

| Metric | Direct Sol | Sol → 16×Sol | Sol → 16×Luna |
| --- | ---: | ---: | ---: |
| F1 | 1.0000 | 0.9897 | 0.8125 |
| Precision | 1.0000 | 0.9796 | 0.8077 |
| Recall | 1.0000 | 1.0000 | 0.8542 |
| Root logical tokens | 116,673 | 15,380 | 15,438 |
| Child logical tokens | 0 | 33,293 | 33,312 |
| Total logical tokens | 116,673 | 48,673 | 48,750 |
| Wall time | 33.31 s | 28.43 s | 24.42 s |

`Sol → Sol` retained 100% median recall and lost only about 0.0103 F1 while reducing median total logical tokens by about 58.3% and root logical tokens by about 86.8% relative to direct Sol.

`Sol → Luna` used essentially the same number of logical tokens as `Sol → Sol` and was about 14% faster, but quality fell materially on this task. This benchmark therefore does **not** support making a cheaper fixed child model the default. It supports exposing fixed routing as an explicit policy and benchmarking it per workload.

## Routing evidence

The runner rejects a run when observed child session identities do not match the requested policy. All successful mixed-model runs observed exactly `openai/gpt-6-luna#low`; inherit runs observed exactly `openai/gpt-6-sol#low`. An earlier live attempt exposed and led to a fix for host-config discovery when `XDG_CONFIG_HOME` is unset; the completed evidence was produced after that fix.

## Accounting caveats

- Logical token counts include cache-read tokens.
- The ChatGPT-backed OpenCode provider reports zero dollar cost for these sessions, so this record does not claim a billed-dollar saving. Model mix and token counts are reported instead.
- The RLM arms use benchmark-only fixed orchestration so the experiment measures child routing rather than generated-JavaScript reliability.
- Three runs per arm reduce but do not eliminate model variance.
- This corpus is about 75 KiB and should not be generalized to every repository workload.

Machine-readable evidence: `routing.json`.
