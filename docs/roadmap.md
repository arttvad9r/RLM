# RLM roadmap

Updated: 2026-10-17

This roadmap follows the ecosystem review in [`ecosystem-gap-analysis.md`](ecosystem-gap-analysis.md). It deliberately avoids feature-parity work with the official RLM runtime, DSPy.RLM and Prime Agent.

## Product direction

RLM should be a **secure host-neutral capability layer for existing coding agents**, not another standalone coding agent.

Core contract:

```text
existing coding agent
        |
   host adapter
        |
     RLM core
   /    |     \
context memory children
        |
zero-permission generated-code sandbox
```

The host owns authentication, model/provider access, the outer reasoning loop, conversation persistence, ordinary tools, durable memory and user interaction. RLM owns bounded context computation, semantic child delegation, turn-scoped scratch state, budgets and evidence.

## P0 — fix core semantics before adding surface area

### Separate child total budget from concurrency

Implemented 2026-10-17: the runtime now separates total fan-out from active concurrency. Current defaults are `16 total / 4 concurrent / 32 per turn`.

Current behavior:

- keep a conservative concurrency ceiling, initially 4;
- allow 16 child calls per `rlm_exec`;
- allow 32 child calls per root turn;
- make `llm.batch(prompts)` queue work in bounded FIFO waves when `prompts.length` exceeds concurrency;
- preserve result ordering;
- ensure cancellation/turn supersession stops queued work;
- keep hard prompt/result/turn wall limits.

Current production default:

```text
concurrent children: 4
children per exec:   16
children per turn:   32
```

Benchmark 4/8/16 semantic partitions to validate or revise these defaults.

### Add child model policy

Implemented 2026-10-17 through host-neutral `host.json` configuration:

```text
child_model.strategy = inherit | fixed
child_model.provider
child_model.model
child_model.variant
```

Current semantics:

- `inherit` is the default and preserves exact root model/variant;
- `fixed` is selected by trusted host configuration, never by generated sandbox code;
- OpenCode requires provider/model and preserves variant;
- Codex accepts OpenAI/Codex model names and maps variant to reasoning effort;
- adapters fail closed when they cannot resolve the requested fixed provider/model;
- `rlm_exec` metadata records the observed child model identities and routing strategy.

Fixed-routing benchmark evidence now exists for the frozen 384-file semantic audit (`openai/gpt-6-sol#low` root, 16 children, three runs per arm): inherited Sol children achieved median F1 `0.9897` with `48,673` total logical tokens, while fixed Luna-low children achieved median F1 `0.8125` with `48,750` total logical tokens. Direct Sol scored F1 `1.0000` with `116,673` logical root tokens. See `benchmarks/runs/2026-10-17-gpt-6-sol-low-child-routing-384/`.

The result validates the routing mechanism but does not justify cheap-child routing as a default. Adaptive routing remains a P2 experiment: escalation must be based on observable verification signals rather than assuming a cheaper model is good enough.

### Re-run scaling benchmarks

Completed 2026-10-17 on the frozen 384-file semantic-state corpus with `openai/gpt-6-luna#low`: one `rlm_exec` with 4, 8 and 16 semantic children, three balanced-order runs per fan-out, cache-inclusive token accounting.

Median results:

- 4 children: F1 `0.8172`, recall `0.7917`, total logical tokens `46,412`;
- 8 children: F1 `0.8119`, recall `0.8542`, total logical tokens `47,374`;
- 16 children: F1 `0.8400`, recall `0.8958`, total logical tokens `48,880`.

On this sample, 16 children improved coverage and median F1 modestly for about 5.3% more logical tokens, while 8 children did not improve median F1. The result supports bounded configurable fan-out rather than a universal 16-child default. Evidence is under `benchmarks/runs/2026-10-17-gpt-6-luna-low-fanout-384/`.

Next benchmark work:

1. multi-stage memory only where later stages genuinely depend on earlier results;
2. repeat fan-out/routing on a larger or qualitatively different corpus before changing production defaults from one workload;
3. evaluate confidence/disagreement signals before attempting adaptive cheap-to-strong child escalation.

## P1 — improve reliability and observability

### Structured orchestration layer

Initial implementation completed 2026-10-17 with `rlm_map`. Free-form `rlm_exec` remains the escape hatch, while standard repository partition/map/merge workloads use a validated higher-level path compiled to a fixed trusted template. The structured contract now also supports deterministic `balanced_chars` partitioning, explicit `strict | settled` failure semantics, partition-scoped path validation, prompt-size preflight, a hard-bounded candidate source handoff, host-side schema validation, and a versioned conservative-verification contract.

Desired primitives:

- partition/chunk — implemented for round-robin and character-balanced file partitions;
- semantic map/classify/extract — implemented as the structured child map stage;
- filter — path/candidate selection is implemented, broader typed filters remain future work;
- deduplicate/sort — implemented for path outputs;
- reduce/merge — deterministic path merge is implemented, generic semantic reduce remains future work;
- optional candidate verification — contract implemented; root-side conservative verification remains host-owned rather than a second generic classifier.

Design constraints:

- deterministic control flow outside model calls;
- hard bounded fan-out;
- no arbitrary filesystem/network authority;
- same context, child and memory budgets as `rlm_exec`;
- generated prompts/data remain inspectable in benchmark evidence without leaking them into normal logs by default.

Do not remove free-form JavaScript unless evidence shows the structured API can replace it across real coding tasks.

Structured reliability hardening completed 2026-10-17 also includes deterministic `balanced_chars` partitioning, strict/settled child-failure modes, partition-local candidate validation, prompt-size preflight before inference, operation-specific child response bounds before parsing, no automatic model repair/retry for malformed output, a versioned host-validated result contract, bounded candidate-source handoff, and same-boundary exact-request duplicate suppression. The duplicate guard was added after DeepSeek V4.1 Flash repeated an identical structured call during a live benchmark. An intentional live regression then called the same two-way `rlm_map` twice inside one Code Mode execution and observed two nested map calls but only two child sessions, confirming that the second call reused the completed result. Raw `rlm_exec` is deliberately not deduplicated because it may have working-memory side effects.

`balanced_chars` remains opt-in. On the frozen 96-file corpus it reduces deterministic four-way source-size skew from `1,102` characters to `84`, but the first valid DeepSeek samples were both perfect in quality and did not show a latency advantage for balanced partitioning. A four-way 384-file DeepSeek run exceeded the current 120-second execution ceiling, so provider throughput is treated as part of the workload rather than a reason to weaken the global safety timeout.

#### Candidate verification evidence

A 2026-10-17 Sol-low experiment tested a two-stage pattern on the frozen 384-file semantic audit. A 16-child scan returned only candidate paths/source to the root. Naive full reclassification was harmful (median F1 `0.9091`) because the verifier over-applied the lifecycle-state exception. A conservative precision filter — reject only clearly safe candidates, preserve uncertainty, and define lifecycle state by the mutated field rather than a string literal — scored F1/precision/recall `1.0000` in all three successful runs. Median total logical tokens were `54,278`, versus `48,694` for scan-only (+11.5%) and `116,673` for the earlier direct-Sol baseline (-53.5%).

This supports a future structured verification primitive, but its semantics must be **asymmetric**: first-stage candidates are presumptively valid and the verifier removes only explicit false positives. A generic second classifier is not acceptable. The primitive should also bypass free-form Code Mode glue; the experiment observed model-added punctuation breaking an otherwise trivial one-line JavaScript call before RLM execution. Evidence is under `benchmarks/runs/2026-10-17-gpt-6-sol-low-root-verify-384/` and `benchmarks/runs/2026-10-17-gpt-6-sol-low-root-verify-conservative-384/`.

### Stable telemetry/evidence contract

Initial implementation completed 2026-10-17: successful executions now include a canonical host-neutral `telemetry` v1 envelope while legacy flat metadata remains temporarily for benchmark/tooling compatibility. Child accounting includes separate input/output and provider-reported cache-read/cache-write token totals when available, plus a bounded per-invocation usage array (index/model/status/latency/returned-text characters/token-cache-cost counters/error code). Structured map telemetry separately counts format and response-limit violations, keeping provider-call success distinct from post-generation structured validation. Future cost/quota analysis therefore does not have to infer cache behavior from aggregate logical tokens.

Minimum fields:

- run ID / authoritative turn ID;
- adapter/host identity;
- root model identity when available;
- exact child model identities;
- child call outcomes and token/cache/cost totals, plus bounded per-call usage records;
- context call count + chars;
- memory call count + stored-entry/char totals;
- wall time;
- final result size;
- termination/error code;
- budget snapshot.

Privacy default:

- no raw prompts;
- no file contents;
- no memory values;
- no credentials/environment;
- no workspace paths in the canonical telemetry envelope.

Benchmarks may explicitly opt into additional safe evidence in isolated corpora. OpenCode Code Mode currently strips nested plugin metadata from the outer `execute` record, so live benchmark runners must capture root/child session-tree usage before deleting sessions. A dev-only helper now records per-session model/input/output/cache/cost and can optionally cross-check API-equivalent cost with CodeBurn.

A production structured smoke on 2026-10-17 validated `rlm_map` with `ollama-cloud/deepseek-v4.1-flash`, `balanced_chars`, `candidate_bundle`, and two inherited semantic children. The expected two candidates were returned. Provider-reported usage for that smoke was `$0.00231606` at the root plus `$0.000168918` across both children, with `17,920` root cache-read tokens and `256` child cache-read tokens. This is compatibility evidence only, not a quality/cost benchmark.

### Batch failure semantics

Implemented 2026-10-17 without changing strict batch behavior:

```text
llm.batch(...)          # strict; rejects if any child fails
llm.batchSettled(...)   # ordered per-item success/error results
```

Both forms share the same child-call, concurrency and turn budgets. `batchSettled` validates the entire input before transport and is intended only when callers can explicitly handle partial provider/child failures instead of discarding successful sibling results.

## P2 — optional capabilities only if benchmarks justify them

### Recursive child RLM

Potential API:

```text
llm(prompt)      -> plain stateless semantic child
rlm(prompt)      -> bounded child RLM runtime
```

Do not implement simply for feature parity.

Acceptance criteria before building:

- identify at least one reproducible task family where plain children + root orchestration materially underperform;
- define recursion depth and aggregate turn budgets before code exists;
- preserve child filesystem/network isolation;
- ensure child recursion cannot escape root turn cancellation or budget authority;
- benchmark latency/cost against simply using more plain children.

Default recursion must remain disabled.

### Typed host-approved capability registry

Only consider this if fixed `context.*`, `memory.*` and child calls prove insufficient for adapters.

Any extension must be:

- explicitly registered by the trusted host;
- typed/JSON-serializable across the protocol;
- individually budgeted;
- deny-by-default;
- unavailable to child models unless separately authorized.

Do not expose arbitrary host JavaScript/Python functions or ambient agent tools directly to generated code.

### Adaptive child routing

Only after `fixed` child-model routing has stable evidence.

Possible policy:

```text
cheap child
  -> accept bounded/high-confidence result
  -> otherwise escalate selected item to stronger child/root
```

Escalation criteria must be observable and testable; avoid self-reported model confidence as the only trigger.

## Adapter roadmap

### Codex

Keep the MCP adapter thin:

- authoritative thread/turn/workspace resolution;
- child execution under isolated Codex profile;
- model/reasoning resolution;
- lifecycle/budget integration.

Do not make Codex-specific behavior part of core semantics.

### OpenCode

Keep V2 adapter responsibilities limited to:

- authoritative session/turn boundary resolution;
- child session creation;
- deny-all child context/tool isolation;
- session deletion cleanup;
- model/variant mapping.

Do not weaken child isolation to satisfy provider-specific free-tier restrictions.

### Future hosts

A new adapter is worthwhile when it can implement the narrow `RlmHost` contract without forcing host-specific concepts into core.

Potential future adapters are product expansion, not a reason to generalize core prematurely.

## Explicit non-goals

The following are intentionally **not** on the roadmap:

- standalone coding-agent/TUI replacement for Codex/OpenCode;
- first-party model/provider SDK and authentication framework;
- persistent unrestricted Python/IPython kernel;
- durable cross-session personal/project memory system;
- continual-harness/skills/goals implementation;
- background daemon agents, schedules or heartbeats;
- arbitrary custom host tools inside generated code;
- shell/filesystem/network access for generated JavaScript;
- large catalog of Docker/cloud sandbox providers;
- RL/training framework;
- host conversation compaction;
- duplicating ordinary subagent/task-agent frameworks.

If one of these becomes necessary, first verify that the capability cannot remain owned by the host agent or be integrated through a narrow adapter/capability boundary.

## Success criteria

The project should be considered successful if it can demonstrate that an existing coding agent gains measurable large-context capability from installing RLM while preserving a small, auditable authority boundary.

Useful evidence includes:

- improved semantic coverage as repository/corpus size grows;
- reduced root-context pressure relative to direct root analysis;
- useful economics from strong root + cheaper children;
- predictable degradation under budgets/failures;
- no need to replace the user's preferred coding agent;
- security claims backed by deterministic tests and live adapter smokes.

Feature count is not a success metric.
