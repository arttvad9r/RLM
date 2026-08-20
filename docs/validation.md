# Validation tiers

RLM validation is intentionally split into independent layers so host regressions, Deno sandbox behavior, real OpenCode integration, benchmark value, and deployment isolation are not conflated.

A passing result is evidence only for the exact Git revision and environment that actually executed it.

For the step-by-step machine procedure, use [`local-development.md`](local-development.md).

## Runtime baseline

Repository/container validation is pinned to:

- Node.js `24.19.0`;
- Deno `2.9.5`;
- the committed `package-lock.json` dependency graph.

`npm run check:runtime` accepts Node 24.x and Deno 2.x for ordinary local development. Acceptance/reproducibility work should additionally run:

```sh
node scripts/check-runtime.mjs --exact
```

The exact check is also part of hosted/container validation.

## Tier 1: host gate

```sh
npm run gate:host
```

This validates:

- standalone repository shape/coupling guard;
- Node-native host/runtime tests;
- host TypeScript;
- benchmark harness tests;
- frozen benchmark fixture integrity.

It does **not** prove the Deno runner/Worker boundary or real OpenCode integration.

## Tier 2: Deno boundary

For focused diagnosis run:

```sh
npm run typecheck:runner
npm run test:plugin
```

This is the authoritative repository layer for Deno-specific runner/Worker behavior, permissions, transport, cancellation, and generated-code isolation.

A Node-only test pass must never be described as equivalent to this tier.

## Tier 3: full native local gate

With Node 24.x and Deno 2.x installed:

```sh
npm run gate:local
```

This runs `check:runtime` and then the complete repository `npm test` sequence, combining host and Deno layers.

For a hardening revision, this is the minimum native merge-readiness gate unless a stronger project rule is explicitly adopted.

## Tier 4: reproducible container gate

With Docker installed:

```sh
npm run gate:container
```

The image is built from `scripts/Dockerfile.local-gate`, uses Node `24.19.0-bookworm-slim`, copies the Deno `2.9.5` binary from the official Deno image, installs dependencies with `npm ci --ignore-scripts`, verifies exact runtime versions, and runs `npm test`.

This provides reproducible runtime evidence, but it is still repository validation rather than an OpenCode integration or production deployment proof.

## Tier 5: real OpenCode integration

Run the disposable-workspace smoke procedure from [`local-development.md`](local-development.md).

This tier is required to validate assumptions that repository tests cannot prove in isolation, including:

- plugin loading on the installed OpenCode version;
- session/message lifecycle behavior;
- tool inventory/deny-map behavior;
- real child model prompting;
- cancellation propagation through the host;
- compatibility of the exact-pinned OpenCode SDK packages with the installed host.

Do not infer this tier from `npm test` alone.

## Tier 6: benchmark value gate

`npm run test:benchmarks` and `npm run verify:benchmarks` prove evaluator/fixture integrity, not product value.

A value/scaling claim requires real provider/model-matched normal-vs-RLM inference arms as documented in [`../benchmarks/README.md`](../benchmarks/README.md) and [`local-development.md`](local-development.md).

## Tier 7: deployment resource gate

Repository tests cannot prove process-tree cgroup/container enforcement. Deployment validation must separately verify the memory, swap, CPU and PID controls from [`resource-envelope.md`](resource-envelope.md), capture machine-readable cgroup evidence, deliberately exercise a resource-limit termination, and confirm fail-closed behavior plus service recovery.

## Hosted CI interpretation

Hosted GitHub Actions should use the same exact runtime baseline, but hosted execution is not itself a security boundary.

If a workflow run reports failure before any job step is recorded, that is infrastructure evidence only. It is not evidence that repository tests failed, and it is not a passing result either.

Do not manually translate a historical green run to a later revision. Re-run the relevant gate on the exact commit being evaluated.
