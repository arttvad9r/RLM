# GPT-6 Sol low: conservative root verification

Follow-up to the naive verification experiment on the frozen 384-file semantic-state audit.

The first stage is the same 16-child `openai/gpt-6-sol#low` scan. The root receives source only for first-stage candidates and is forbidden from inspecting non-candidates or using additional tools. Verification is conservative: reject a candidate only when the source clearly proves an allowed exception; uncertainty preserves the candidate. The prompt also clarifies that a value such as `pending-value` written to an ordinary result/domain field is still result-state mutation; lifecycle exceptions apply to lifecycle fields themselves.

## Three successful runs

All three successful runs scored:

- F1: `1.0000`;
- precision: `1.0000`;
- recall: `1.0000`.

Median resource use:

| metric | conservative verify |
| --- | ---: |
| root logical tokens | 20,985 |
| child logical tokens | 33,293 |
| total logical tokens | 54,278 |
| wall time | 27.38 s |
| first-stage candidates | 49 |

Compared with the immediately preceding three-run scan-only baseline, verification adds about 5,584 logical tokens (+11.5%) and restores median F1 from `0.9897` to `1.0000` in this sample.

Compared with the earlier three-run direct Sol baseline on the same frozen corpus, median total logical tokens are 54,278 vs 116,673 (-53.5%), while both score F1 `1.0000`. Median root logical tokens are 20,985 vs 116,673 (-82.0%). These comparisons are exploratory; the direct and conservative-verification runs were produced by separate repeated series rather than one shared synthetic snapshot.

One earlier attempt series also exposed a Code Mode reliability issue: the root occasionally added a trailing period to an exact one-line JavaScript call, causing parse failure before RLM execution. Those parse failures were not counted as verification results.

Raw evidence is in `conservative-verification.json`.