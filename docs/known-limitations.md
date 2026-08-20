# Known limitations and hardening backlog

This document records boundaries that are not silently treated as solved. They require explicit design changes and/or target-runtime evidence rather than heuristic patches.

## Process-level resource boundary

The trusted Deno transport is started with a host-owned V8 old-space ceiling and the generated-code Worker has `permissions: "none"`. The V8 limit bounds the primary JavaScript heap but is not a complete RSS/CPU/process-tree isolation boundary.

[`resource-envelope.md`](resource-envelope.md) defines the supported OS-level deployment contract, a reference cgroup/container profile, and fail-closed semantics for external transport termination. Repository tests verify the application failure/cleanup contract, but they cannot prove that a target deployment actually applies the required cgroup/container controls.

Do not claim a hard OS resource guarantee until the target deployment has validated the full OpenCode/RLM process tree inside that envelope and exercised deliberate limit termination plus recovery.

## Pathname confinement race

`confinePath()` canonicalizes and verifies a candidate path before context code later performs `stat`, `open`, or `opendir`. Those are separate pathname operations. Stable symlink escapes fail closed, but a hostile process with concurrent write authority inside the workspace could theoretically race a rename or symlink replacement between validation and use.

Closing this boundary portably requires descriptor-relative traversal (`openat`/`O_NOFOLLOW`-style semantics or an equivalent native helper) rather than another pathname heuristic.

Until that design is implemented and validated, do not represent context confinement as resistant to a malicious concurrent filesystem mutator.

## Deno runtime compatibility gate

The trusted runner explicitly disables project config, lockfile discovery, npm resolution and remote module resolution. Its only Deno permission grant is scoped read access to the fixed generated Worker entry module; generated model code runs in a Worker with `permissions: "none"`.

Node-native host regressions can validate command construction, host policy, protocol and lifecycle logic without Deno, but they are not a substitute for executing `deno check` and the Deno runtime regression suite on a supported Deno 2.x build.

Changes to runner flags, Worker options, Deno compatibility APIs or transport behavior require the Deno-specific/full local gate before compatibility is claimed.

## OpenCode host / SDK compatibility boundary

The repository intentionally exact-pins `@opencode-ai/plugin` and `@opencode-ai/sdk` to a known baseline. Repository unit/integration tests can exercise the expected SDK envelope, but they cannot prove that a separately installed, newer OpenCode host still preserves every session, hook, tool-inventory and cancellation behavior on which RLM relies.

A real OpenCode smoke test on the target host version is required before host compatibility is claimed. Establish the pinned baseline first. Evaluate newer OpenCode SDK packages as a separate compatibility change rather than mixing an SDK migration into unrelated runtime hardening.

The child-session retention policy in [`session-lifecycle.md`](session-lifecycle.md) is also version-sensitive because it relies on OpenCode parent/recursive-delete behavior.

## Root session deletion versus active execution cancellation

The plugin evicts turn-governor authority on the authoritative `session.deleted` event. Active `rlm_exec` cancellation is primarily owned by the host-provided abort signal and the existing sandbox/child cancellation chain.

The repository does not currently claim a second, independently proven plugin-event cancellation owner that kills an already-running sandbox solely because `session.deleted` was observed. Adding one could introduce double-cancellation or ordering races and should be designed/tested against real OpenCode lifecycle behavior rather than added heuristically.

## Benchmark effectiveness boundary

The frozen benchmark corpora, manifests, scoring harness and integrity checks establish reproducible evaluator infrastructure. They do not establish that RLM is more accurate, cheaper, faster, or better-scaling than a normal agent.

Those claims require real provider/model-matched normal-vs-RLM inference arms. Ground truth and manifests must remain outside model context, and RLM arms must record actual `rlm_exec` use. See [`../benchmarks/README.md`](../benchmarks/README.md) and [`local-development.md`](local-development.md).

## Validation evidence boundary

Validation claims remain revision-specific. Until the relevant commands are actually executed on a concrete commit or tested merge tree, repository documentation must not describe that revision as passing typecheck, Deno runtime tests, OpenCode integration, benchmark value checks, or deployment isolation.

A successful historical CI/local run is evidence only for the revision it validated. Conversely, a hosted CI job that fails before recording any workflow step is infrastructure evidence rather than a repository test failure.
