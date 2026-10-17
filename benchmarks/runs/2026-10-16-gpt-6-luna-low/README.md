# GPT-6 Luna low — exploratory RLM A/B benchmark

Date: 2026-10-16

Root model: `openai/gpt-6-luna#low`

Source snapshot: `658b72260d75958f46ea263d87b80ccd2dd787a4` (`refs/benchmarks/luna-low-20261016` locally when recorded)

Experiment config SHA-256: `b06b640243a1d5c39ea7396e1535c47df9024203e2bc756b90874e21f2867b8e`

These runs compare the canonical semantic-state audit in normal OpenCode mode against the same root model with RLM available. Both arms use the same task prompt, workspace instructions, root agent, model variant, permission restrictions, corpus bytes and source snapshot. The RLM arm uses one fixed orchestration template, one `rlm_exec`, four isolated `#low` children and targeted root verification of candidates.

## Results

| Corpus | Mode | TP | FP | FN | F1 | Root tokens | Child tokens | Total tokens | Wall time |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 96 | Normal | 3 | 5 | 9 | 0.3000 | 15,538 | 0 | 15,538 | 20.97 s |
| 96 | RLM | 11 | 1 | 1 | 0.9167 | 10,425 | 8,044 | 18,469 | 29.84 s |
| 192 | Normal | 23 | 1 | 1 | 0.9583 | 29,455 | 0 | 29,455 | 34.38 s |
| 192 | RLM | 21 | 0 | 3 | 0.9333 | 11,900 | 15,727 | 27,627 | 36.13 s |
| 384 | Normal | 0 | 0 | 48 | 0.0000 | 37,893 | 0 | 37,893 | 22.61 s |
| 384 | RLM | 42 | 0 | 6 | 0.9333 | 13,719 | 31,001 | 44,720 | 30.98 s |

Relative to normal mode, RLM changed total token use by **+18.9%** at 96 files, **-6.2%** at 192 files and **+18.0%** at 384 files. Wall time increased by approximately **42.3%**, **5.1%** and **37.0%**, respectively.

The clearest scaling signal is root-context pressure. Root token use in the RLM arm stayed at roughly 10–14k across all three corpus sizes while normal-mode root use grew from 15.5k to 37.9k. RLM shifted semantic work into four bounded children rather than making the root consume the whole corpus directly.

## Interpretation

This single exploratory suite does **not** show that RLM is universally cheaper or faster. It was slower at every tested size and only reduced total tokens at 192 files.

It does show a potentially important quality/coverage benefit under scale. At 384 files the normal Luna-low run returned no violations at all, while RLM found 42 of 48 with no false positives (F1 0.9333). At 96 files RLM also materially outperformed the sampled normal run. At 192 files normal mode was slightly better on F1, while RLM used fewer total tokens and achieved perfect precision.

The 384-file corpus is still only about 75 KiB of TypeScript source, so this should not be presented as proof of very-large-context superiority. It is evidence that decomposition can protect semantic coverage when the root agent's own workspace strategy degrades.

## Caveats

- There is only **one recorded run per arm per size**. GPT-6 Luna low is stochastic, so these numbers are exploratory rather than statistically stable.
- OpenCode's ChatGPT-backed provider reported `cost_usd: 0`; that is a subscription accounting artifact and does not prove inference was free. Dollar-cost comparisons are therefore unavailable from this suite.
- The 384 RLM final response duplicated one path. The experiment config pre-declared deterministic scoring normalization: parse the final JSON array, retain string paths, deduplicate and lexicographically sort. The raw response and `normalized_format:duplicate_paths` evidence are retained in the run record.
- Exact internal RLM context-call and context-character telemetry is not exposed through OpenCode Code Mode nested-tool metadata. Those schema fields are stored as zero placeholders and are explicitly excluded from efficiency conclusions.
- The RLM arm uses a fixed safe orchestration template. Earlier diagnostic runs showed that Luna low can generate invalid nested JavaScript when asked to invent the whole `rlm_exec` program itself. This suite therefore measures the RLM architecture under a guided strategy, not autonomous orchestration-code reliability.
- Benchmarking exposed an OpenCode adapter bug where child sessions inherited the model ID but lost the root `variant`, falling back from `#low` to `default`. That bug was fixed before this recorded suite; every recorded RLM child is verified as `openai/gpt-6-luna#low`.

Before making a strong README performance claim, repeat each arm at least three times (preferably with randomized/interleaved arm order) and report median/dispersion. A second suite on a stronger root model such as Sol would help separate RLM effects from Luna-low variance.

## Evidence

The directory contains the exact shared experiment config and workspace instructions, raw provider/session evidence, schema-v2 run records, scored reports, pair comparisons and the required 192/384 suite record.

The canonical scorer/harness remains under `benchmarks/harness/`; ground truth was not present in the inference workspaces.
