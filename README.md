# OpenCode RLM

Standalone Recursive Language Model runtime/plugin for OpenCode.

This repository contains only the RLM agent, plugin runtime and deterministic benchmark assets. It does not contain or depend on an external scheduler, Planner/Worker contracts, verifier, acceptance state or Git control plane.

## Start here

- [`docs/README.md`](docs/README.md) — documentation index.
- [`docs/local-development.md`](docs/local-development.md) — authoritative local synchronization, development and acceptance runbook.
- [`docs/local-agent-prompt.md`](docs/local-agent-prompt.md) — ready-to-paste prompt for a local coding agent.
- [`docs/runtime-invariants.md`](docs/runtime-invariants.md) — security/runtime invariants.
- [`docs/known-limitations.md`](docs/known-limitations.md) — boundaries that are intentionally not represented as solved.
- [`docs/resource-envelope.md`](docs/resource-envelope.md) — deployment cgroup/container contract.
- [`benchmarks/README.md`](benchmarks/README.md) — benchmark protocol and evaluator.

**Important for the current hardening work:** the real local checkout and the GitHub feature branch may contain different work. The local workflow therefore begins with a non-destructive Git reconciliation step. Do not install dependencies, add Nix files, run acceptance gates, or modify runtime code until all relevant local-only and remote-only work has been inspected, preserved, integrated, and the intended feature branch is synchronized with `origin`.

## Layout

- `agent/rlm.md` — RLM-aware OpenCode agent prompt.
- `plugin/rlm.ts` — plugin entrypoint exposing `rlm_exec`.
- `plugin/rlm-lib/` — host-side child sessions, context policy, protocol, budgets and sandbox lifecycle.
- `plugin/rlm-runner/` — trusted Deno transport plus the zero-permission generated-code Worker.
- `plugin/tests-host/` — Node-native host/runtime regressions that do not require Deno or a model provider.
- `plugin/tests/` — Deno runtime/security regressions, including runner/Worker isolation.
- `benchmarks/` — frozen semantic-state corpora, manifests, ground truth and provider-neutral scoring/comparison harness.
- `scripts/` — standalone, runtime, container and resource-envelope validation helpers.
- `docs/` — operational, security, validation and provenance documentation.

## Requirements

Supported native development runtime:

- Node.js 24.x;
- Deno 2.x;
- OpenCode plugin/SDK `1.1.26` for the currently pinned baseline.

The exact reproducible repository/container baseline is Node `24.19.0` + Deno `2.9.5`.

Install npm dependencies only after repository synchronization:

```sh
npm ci --ignore-scripts
```

The committed lockfile pins the transitive npm dependency graph used by validation.

On NixOS, a reproducible `nix develop`/`nix shell` workflow is preferred over globally installing development runtimes. See `docs/local-development.md`; project Nix scaffolding, when needed, is a post-synchronization development task.

## Validation

Fast host-only feedback:

```sh
npm run gate:host
```

Complete native Node+Deno gate:

```sh
npm run gate:local
```

Exact reproducible container gate:

```sh
npm run gate:container
```

These commands prove different things. A Node-native pass is not a Deno sandbox pass; a repository pass is not real OpenCode compatibility; a container pass is not deployment cgroup evidence; benchmark harness tests do not prove that RLM improves model performance.

See [`docs/validation.md`](docs/validation.md) and [`docs/local-development.md`](docs/local-development.md) before making a merge/readiness claim.

## Context authority

Context-root authority is resolved in this order:

1. `$XDG_CONFIG_HOME/opencode/agents/.rlm-host.json` when present;
2. `OPENCODE_RLM_CONTEXT_ROOT` when no host config exists;
3. the OpenCode worktree for a normal Git session;
4. the OpenCode session directory for a non-Git session.

A host config has schema:

```json
{
  "version": 1,
  "context_root": "/absolute/project/root",
  "context_policy": {
    "allowed_paths": ["src", "docs"],
    "max_read_bytes": 131072,
    "max_grep_matches": 200,
    "max_list_entries": 4096
  }
}
```

When no host config exists, `OPENCODE_RLM_CONTEXT_POLICY` may supply the same `context_policy` object as JSON. Policy values may narrow but not widen compiled hard limits. A present host config takes precedence over ambient environment authority. Filesystem root and the user's HOME are rejected as context roots; credential namespaces are hard-denied by the context policy.

## Security model

`rlm_exec` does not intentionally give model-generated JavaScript filesystem, network, environment, subprocess or FFI authority.

The host launches a trusted Deno transport runner with narrowly scoped read access to the fixed generated Worker entry module. Project config, lockfile discovery, npm resolution and remote module loading are disabled for the runner. Ambient `DENO_PERMISSION_BROKER_PATH` is removed. Generated code executes in a separate Worker with `permissions: "none"`. Host/runner frames use a per-execution authenticated channel, and runner/Worker RPC uses a private transferred `MessagePort`.

Context access is host-mediated through bounded read-only APIs. Child sessions are stateless semantic workers with ordinary OpenCode tools denied. Turn budgets use authoritative session/message identity and fail closed when identity cannot be resolved.

This is not a claim of complete hostile multi-user filesystem isolation. The pathname validation/use race documented in [`docs/known-limitations.md`](docs/known-limitations.md) remains unresolved pending descriptor-relative confinement. OS-level CPU/RSS/process-tree guarantees likewise require the deployment envelope in [`docs/resource-envelope.md`](docs/resource-envelope.md).

## OpenCode compatibility

The repository currently pins `@opencode-ai/plugin` and `@opencode-ai/sdk` `1.1.26`. Repository tests validate the implementation against that compile/runtime surface but do not prove compatibility with every installed OpenCode host version.

A real OpenCode smoke test on the exact RLM revision is required before claiming host compatibility. SDK/package upgrades should be evaluated separately after the pinned baseline is understood and green.

## Benchmarks

The benchmark harness verifies frozen fixtures and scoring integrity. It does not prove that using RLM is beneficial.

A real effectiveness decision requires matched normal-vs-RLM runs at the documented corpus sizes with the same source revision, model/provider, prompt and experiment configuration. Ground truth and manifests must never be exposed to the model during inference. See [`benchmarks/README.md`](benchmarks/README.md) and [`docs/local-development.md`](docs/local-development.md).

## Integration boundary

Downstream projects may expose this plugin behind their own runtime selector or authority layer. Project-specific scheduler state, acceptance authority, verifier logic and external Planner/Worker contracts stay outside this standalone runtime.

## Provenance

The standalone repository was migrated from a certified source tree. Provenance SHAs and the migration-specific historical validation record are retained in [`docs/repository-migration.md`](docs/repository-migration.md). That document is historical evidence, not the current development or acceptance runbook.
