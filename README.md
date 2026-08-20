# OpenCode RLM

Standalone Recursive Language Model runtime/plugin for OpenCode.

RLM provides a bounded `rlm_exec` execution surface for large semantic-analysis tasks. Generated JavaScript runs in a zero-permission Deno Worker and can reach the host only through the narrow `llm` and read-only `context` APIs implemented by this repository.

This repository is runtime-only. It does **not** own an Autopilot scheduler, Planner/Worker orchestration, verifier/acceptance authority, Git control plane, or downstream model-routing policy.

## Quick start

Requirements:

- Node.js 24.x;
- Deno 2.x;
- npm;
- OpenCode for real integration testing;
- Docker for the reproducible container gate.

The reproducible validation baseline is Node `24.19.0` + Deno `2.9.5`. OpenCode plugin/SDK packages are currently exact-pinned to `1.1.26` in `package.json` and `package-lock.json`.

Install the pinned npm graph:

```sh
npm ci --ignore-scripts
```

Run the fast host-only gate:

```sh
npm run gate:host
```

Run the complete native gate on a machine with Node 24.x and Deno 2.x:

```sh
npm run gate:local
```

Run the exact reproducible Node/Deno container gate:

```sh
npm run gate:container
```

For the full machine-acceptance procedure, OpenCode smoke test, benchmark plan and evidence requirements, use [`docs/local-development.md`](docs/local-development.md).

For a ready-to-paste local coding-agent instruction, use [`docs/local-agent-prompt.md`](docs/local-agent-prompt.md).

## Repository layout

- `agent/rlm.md` — RLM-aware OpenCode agent prompt.
- `plugin/rlm.ts` — plugin entrypoint exposing `rlm_exec`.
- `plugin/rlm-lib/` — host-side child sessions, context policy, protocol, budgets and sandbox lifecycle.
- `plugin/rlm-runner/` — trusted Deno transport and zero-permission generated-code Worker.
- `plugin/tests-host/` — Node-native host/runtime regressions.
- `plugin/tests/` — Deno runtime/security regressions.
- `benchmarks/` — frozen semantic-state corpora and provider-neutral scoring/comparison harness.
- `scripts/` — standalone/runtime/container/resource-envelope validation tooling.
- `docs/` — runtime contracts, local/deployment validation, limitations and historical records.

Documentation index: [`docs/README.md`](docs/README.md).

## Validation model

Validation is deliberately tiered:

1. `npm run gate:host` — standalone guard, host regressions, host TypeScript and benchmark fixture/harness integrity;
2. `npm run typecheck:runner` + `npm run test:plugin` — Deno runner/Worker boundary;
3. `npm run gate:local` — authoritative native repository gate;
4. `npm run gate:container` — exact pinned Node/Deno container gate;
5. real OpenCode smoke test — actual plugin/SDK/host integration;
6. real normal-vs-RLM benchmark arms — product-value evidence;
7. target cgroup/container validation — production OS resource-boundary evidence.

See [`docs/validation.md`](docs/validation.md) for what each tier proves and does not prove.

A passing claim is always revision-specific. A historical CI or local pass is not evidence for a later commit.

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

When no host config exists, `OPENCODE_RLM_CONTEXT_POLICY` may provide the same `context_policy` object as JSON. Policy values and test-only budget overrides can narrow compiled limits but cannot widen them.

Filesystem root and the user's HOME are rejected as context roots. Common credential stores, private keys, Terraform state, `.git`, and `.env*` are hard-denied by the generic context boundary; `.env.example` is the deliberate terminal-file exception.

## Security model

`rlm_exec` does not intentionally grant model-generated code filesystem, network, environment, subprocess, FFI, OpenCode client/session, or ordinary tool authority.

The host launches a trusted Deno transport with project config, lockfile discovery, npm resolution and remote loading disabled. Ambient `DENO_PERMISSION_BROKER_PATH` is removed before spawn. The generated program runs in a separate Worker with `permissions: "none"`.

Node-to-runner frames use a per-execution authenticated channel. Runner-to-Worker RPC uses a private transferred `MessagePort`. Request identity, transport lines, unauthenticated stdout, child output, context output and key host-side materialization paths are bounded.

Context access is host-mediated through read-only `context.files`, `context.read`, `context.readMany` and `context.grep`. RLM child sessions are stateless semantic workers with a complete false-valued tool deny map and no inherited repository prompt/history/tool surface.

Security/correctness invariants are documented in [`docs/runtime-invariants.md`](docs/runtime-invariants.md). Unresolved boundaries are documented in [`docs/known-limitations.md`](docs/known-limitations.md) and must not be represented as solved.

## Important unresolved boundaries

The main explicit limitations are:

- pathname confinement is not yet resistant to a malicious concurrent filesystem mutator; descriptor-relative/openat-style traversal remains separate work;
- the Deno V8 heap ceiling is not a complete OS RSS/CPU/PID boundary;
- repository tests do not prove compatibility with every newer OpenCode release beyond the exact-pinned SDK baseline;
- benchmark harness integrity does not prove RLM is useful until real normal/RLM inference arms are recorded.

See [`docs/known-limitations.md`](docs/known-limitations.md) and [`docs/resource-envelope.md`](docs/resource-envelope.md).

## Benchmarks

See [`benchmarks/README.md`](benchmarks/README.md).

Ground truth and manifests are evaluator infrastructure and must never be included in the runtime context root or otherwise exposed to the model during a benchmark inference arm.

## Development workflow

Before changing runtime/security behavior, read:

- [`docs/runtime-invariants.md`](docs/runtime-invariants.md);
- [`docs/known-limitations.md`](docs/known-limitations.md);
- [`docs/local-development.md`](docs/local-development.md).

Do not weaken limits, permissions, deny rules or regression tests to obtain a green gate. First reproduce the failure, determine whether it is implementation, fixture, dependency/API or environment behavior, then make the narrowest defensible change and add a regression.

Dependency/SDK migrations should be isolated from unrelated hardening work. Establish a green pinned baseline before evaluating newer OpenCode packages.

## Provenance

RLM was migrated from a certified standalone source tree in `arttvad9r/Opencode-Autopilot` into this dedicated repository without importing Autopilot development ancestry. The exact source/target commits, trees and migration validation record are retained in [`docs/repository-migration.md`](docs/repository-migration.md).
