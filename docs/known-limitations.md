# Known limitations and hardening backlog

This document records boundaries that are not silently treated as solved. They require an explicit design change and validation rather than heuristic patches.

## Process-level resource boundary

The trusted Deno transport is started with a host-owned V8 old-space ceiling and the generated-code Worker has `permissions: "none"`. The V8 limit bounds the primary JavaScript heap but is not a complete RSS/CPU/process-tree isolation boundary.

`docs/resource-envelope.md` defines the supported OS-level deployment contract, a reference cgroup/container profile, and the fail-closed semantics for external transport termination. Repository CI verifies the production failure/cleanup behavior, but it cannot prove that a target deployment actually applies the required cgroup/container controls. Do not claim a hard OS resource guarantee until the target deployment has validated the full OpenCode/RLM process tree inside that envelope.

## Host filesystem mutation race

The host context layer canonicalizes and confines paths before bounded reads, but it does not provide an OS-level atomic `openat2`-style path-resolution boundary across every supported platform. The current threat model therefore assumes that the approved workspace is not being adversarially renamed or symlink-swapped by another local process during an RLM context operation.

Do not treat the generic host context layer as a security boundary against a hostile process that can concurrently mutate the workspace. Stronger guarantees require a platform-specific directory-handle/open-relative design or an external filesystem/container boundary.

## Deno runtime compatibility gate

The trusted runner command explicitly disables project config, lockfile discovery, npm resolution and remote module resolution with `--no-config`, `--no-lock`, `--no-npm` and `--no-remote`. Its only Deno permission grant is scoped read access to the fixed generated Worker entry module; generated model code runs in a Worker with `permissions: "none"`.

Node-native host regressions can validate command construction, host policy, protocol and lifecycle logic without a Deno installation, but they are not a substitute for executing `deno check` and the Deno runtime regression suite on a supported Deno 2.x build. Changes to runner flags, Worker options or Deno-specific APIs require that full gate before compatibility is claimed.

## Validation evidence boundary

The dedicated repository now runs Standalone RLM CI from default branch `main`. The earlier non-default-branch CI placement limitation no longer applies.

Validation claims remain revision-specific. Until the relevant commands are actually executed on a concrete commit or tested merge tree, repository documentation must not describe that revision as passing typecheck, Deno runtime tests or benchmark integrity checks. A successful historical CI run is evidence only for the revision it validated.

## Codex child authority model

The Codex adapter cannot currently claim that child processes have an empty tool inventory. Instead, each child is an ephemeral `codex exec` launched in an empty temporary directory with user config/rules ignored, project docs disabled, filesystem authority denied for `/`, network authority disabled, login-shell authority disabled and shell-environment inheritance disabled. The security claim is therefore **no filesystem/network authority for model-invoked tools**, not “no tool objects exist”. Changes to Codex permission-profile semantics require a new live security smoke before this claim is carried forward.

Codex child inference still uses the user's existing Codex authentication. RLM never copies credentials into the prompt or generated-code sandbox.

## Codex MCP lifecycle retention

Codex provides authoritative thread and turn metadata to MCP tool calls, so per-turn budgets and working memory do not rely on TTLs or guessed identities. The current MCP interface does not provide this adapter with an authoritative thread-deleted lifecycle event equivalent to OpenCode `session.deleted`. Codex thread state is therefore retained for the lifetime of the MCP server process rather than evicted heuristically. Working memory is still cleared when that thread advances to a new authoritative user turn and is hard-bounded to 524,288 key-plus-serialized-value characters / 128 entries per retained turn, but many dormant threads can accumulate bounded in-process state until the MCP server exits. OpenCode session deletion evicts the corresponding state immediately.

## Working-memory transaction model

Working memory is volatile host-process scratch space, not a database. Each `memory.get/set/delete/keys` operation is individually applied against the current authoritative user turn, but a multi-call read/modify/write sequence is not transactional across concurrent `rlm_exec` executions. If two concurrent executions intentionally write the same key, host arrival order determines the final value. A successful `memory.set` is also not rolled back merely because later code in the same `rlm_exec` fails. Callers that need deterministic parallel work should use disjoint keys and perform an explicit merge step.

## Live-provider validation

The deterministic test suite does not contact model providers. Live Codex/OpenCode round trips are separate integration evidence because they depend on local authentication, provider availability and quota. A passing deterministic suite must not be described as proof that a particular external model provider is currently reachable.

Runtime telemetry records provider-reported child input/output and, when available, cache-read/cache-write token totals. Those fields are evidence about model traffic, not a promise about subscription quota or billed cost. A provider may account many independent child sessions differently from one long root session, and subscription-backed integrations may report zero monetary cost while still consuming a finite usage allowance. Do not claim dollar/quota savings from logical-token reductions alone; cost claims require a provider/API whose billing and cache accounting are observable.

### Conservative verification is precision-only

`rlm_verify` is intentionally not a generic second classifier. It accepts at most 64 presumptively valid candidate paths, re-reads source through the normal bounded context authority, and runs a two-pass remove-only policy. The first pass may nominate a clear false positive; a separate confirmation child must independently confirm that removal. Uncertainty, failed/malformed/oversized verification, unknown paths, cross-partition selections, or a failed confirmation all resolve to KEEP. First-pass fanout is capped at 8 so first pass plus confirmation cannot exceed the existing 16-child per-execution budget.

This extra confirmation exists because prompt wording alone was not reliable enough. Retained DeepSeek V4.1 Flash evidence includes single-pass runs that incorrectly removed true positives, including ordinary result fields containing strings such as `pending-value`, and a later prompt-hardened paired run that still removed five true positives in one round. Those negative results are kept under `benchmarks/runs/2026-10-17-deepseek-v4.1-flash-structured-verify-96/`; they are part of the design evidence rather than discarded outliers.

After adding independent confirmation, paired 96-file runs use a free GLM root trigger with production fixed routing to `ollama-cloud/deepseek-v4.1-flash` semantic children. Baseline and treatment are scored on the exact same candidate array in each round. In the latest three-run rerun, verified recall remained `1.0000` and no true positive was removed. Verification improved precision in one round and was neutral in two, leaving median F1 `0.8276 -> 0.8276`, median precision `0.7059 -> 0.7059`, and median false positives 5 -> 5. Isolated verifier overhead was median `15.625 s` and `$0.005257` provider-reported child cost per run. A previous two-pass sample with a larger apparent gain is retained beside the current report; the difference is itself evidence of model variance. Three synthetic-corpus rounds therefore support the remove-only safety design more strongly than they support a claim of consistent precision gain: same-model confirmation can still have correlated errors and larger/diverse workloads remain necessary.

The latest tiny live regression also uses separate root/child routing: `opencode/glm-5.3-flash-free` only triggers the flow, while DeepSeek performs semantic map/verification. It kept the ambiguous `pending-value` and `done/text` result-state examples, removed the explicit `loading` lifecycle case after confirmation, created five semantic child sessions, and reported about `$0.00373` child-provider cost. This remains compatibility/mechanics evidence rather than benchmark-scale quality evidence.

### Structured output bounds versus provider token caps

`rlm_map` enforces trusted post-generation response bounds before structured parsing: 32,768 characters per `text` child and 16,384 characters per `path_list` / `candidate_bundle` child. `rlm_verify` uses the same 16,384-character bound for its removal-path arrays. It never launches an automatic LLM repair/retry for an oversized or malformed structured response. These character bounds protect the runtime/protocol and make failure behavior deterministic, but they do **not** by themselves prevent the provider from generating and billing the full response before RLM receives it.

In OpenCode 2.0.29, the public `session.prompt()` input used by the adapter does not expose a per-call `maxTokens` / `maxOutputTokens` field. OpenCode's public session generation hook does expose `request.options.maxTokens`, but it is not a reliable provider-independent cap. A dev-only live probe injected `request.options.maxTokens = 64` for RLM child sessions using `ollama-cloud/deepseek-v4.1-flash`; a fresh 2026-10-17 run still reported 92 and 66 output tokens for the two individual assistant generations, both with `finish: "stop"`. RLM therefore does not currently claim or apply a provider-side output-token cap. The live structured smoke can repeat this probe with `RLM_LIVE_CHILD_MAX_TOKENS`, but any production provider-side limit needs adapter/provider-specific evidence before it can become part of the safety or cost contract.

### OpenCode Code Mode metadata transport

OpenCode 2.0.29 exposes plugin tools to the root model through Code Mode (`execute -> tools.rlm_map/rlm_verify/rlm_exec`). The nested Code Mode call summary currently preserves tool name, status and input but does **not** forward the plugin tool's returned metadata object, and the public session event stream does not surface that nested metadata either. RLM telemetry v1 therefore remains the canonical direct-tool metadata contract, but benchmark tooling running through Code Mode must not assume it can recover that metadata from the outer `execute` record.

For OpenCode live evidence, capture the root and descendant session tree before cleanup and read provider-reported model/usage/cache/cost from those sessions. `scripts/lib/opencode-evidence.mjs` implements that capture and can optionally cross-check the same session IDs with CodeBurn. Do not work around this host limitation by putting raw prompts, file contents, memory values or credentials into tool-visible telemetry content.

### OpenCode free-tier child sessions

On OpenCode 2.0.29, `opencode/glm-5.3-flash-free` succeeds for the root live smoke and for ordinary child sessions, but the provider rejects a child whose effective tool/permission set is fully denied with `FreeTierError` ("free tier can only be used from within OpenCode"). The same behavior reproduces without RLM by creating an OpenCode child session with a deny-all permission rule.

RLM does not weaken its OpenCode child isolation to accommodate that provider restriction. `npm run test:opencode-live` therefore validates package loading, Code Mode routing, `rlm_exec` and the Deno sandbox with the free model; `--recursive` requires a provider/model that permits the deny-all tool-less child design.
