# Validation tiers

RLM validation is intentionally split into independent layers so a hosted CI outage cannot be confused with a repository test failure.

## Runtime baseline

The reproducible container gate is pinned to:

- Node.js `24.19.0` (Node 24 LTS line)
- Deno `2.9.5`
- package-lock pinned npm dependencies

`npm run check:runtime` accepts Node 24.x and Deno 2.x for ordinary local development. The container gate additionally checks the exact pinned versions before running the full repository suite.

## Tier 1: host gate

Run:

```sh
npm run gate:host
```

This validates the standalone tree, host runtime tests, host TypeScript, benchmark harness tests, and committed benchmark fixtures. It does not claim to validate the Deno sandbox boundary.

## Tier 2: full local gate

With Node 24.x and Deno 2.x installed:

```sh
npm run gate:local
```

This checks runtime compatibility and then runs the authoritative `npm test` sequence, including Deno runner typechecking and plugin/sandbox tests.

## Tier 3: reproducible container gate

With Docker installed:

```sh
npm run gate:container
```

The image is built from `scripts/Dockerfile.local-gate`, installs dependencies with `npm ci --ignore-scripts`, verifies the exact pinned Node/Deno versions, and runs `npm test` in the container.

Hosted GitHub Actions should use the same runtime versions, but hosted execution is not itself a security boundary. A job that fails before recording any step is infrastructure failure, not evidence that repository tests failed.

## Tier 4: deployment gate

Repository tests cannot prove process-tree cgroup/container enforcement. Deployment validation must separately verify the documented memory, swap, CPU and PID controls, deliberate resource-limit termination, complete descendant coverage, and service recovery.
