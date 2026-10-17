# GPT-6 Sol low: naive root verification

Exploratory 384-file semantic-state audit comparing one 16-child Sol RLM scan with a second-stage root Sol reclassification of every returned candidate.

The first-stage scan used `openai/gpt-6-sol#low`, 16 inherited Sol-low children and a concurrency ceiling of 4. Both arms were run three times in balanced order with cache-inclusive logical-token accounting.

## Median results

| arm | F1 | precision | recall | root tokens | child tokens | total tokens | wall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| scan only | 0.9897 | 1.0000 | 1.0000 | 15,400 | 33,293 | 48,694 | 28.07 s |
| naive root verify | 0.9091 | 1.0000 | 0.8333 | 20,745 | 33,292 | 54,036 | 24.41 s |

Naive verification was harmful. All three verify runs removed the same eight true positives because the root treated the literal value `pending-value` as lifecycle state even when it was written into an ordinary result/domain field. This is a prompt/verification-policy ambiguity, not random noise.

The result rules out a generic "reclassify every candidate from scratch" verification primitive. Verification must be conservative: reject only candidates that clearly satisfy an allowed exception and preserve uncertain candidates.

Raw evidence is in `verification.json`. This is exploratory evidence, not a universal performance claim.