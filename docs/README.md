# Documentation index

Use this page as the entry point for repository documentation. Validation claims are revision-specific: do not treat a historical passing run as evidence for the current commit.

## Start here

- [`../README.md`](../README.md) — project purpose, architecture boundary, quick start and security overview.
- [`local-development.md`](local-development.md) — authoritative local development and acceptance workflow.
- [`local-agent-prompt.md`](local-agent-prompt.md) — copy/paste prompt for a local coding agent working on this repository.
- [`validation.md`](validation.md) — validation tiers and what each gate does or does not prove.

## Runtime and security contracts

- [`runtime-invariants.md`](runtime-invariants.md) — correctness/security invariants that implementation changes must preserve.
- [`known-limitations.md`](known-limitations.md) — unresolved boundaries that must not be represented as solved.
- [`session-lifecycle.md`](session-lifecycle.md) — semantic child-session retention and deletion assumptions.
- [`resource-envelope.md`](resource-envelope.md) — Linux cgroup/container deployment envelope and verification procedure.

## Benchmarking

- [`../benchmarks/README.md`](../benchmarks/README.md) — frozen corpora, scoring, comparison and experiment-integrity requirements.

Benchmark ground truth and manifests are evaluator infrastructure. Never expose them to the model during an inference arm.

## Historical record

- [`repository-migration.md`](repository-migration.md) — completed migration/provenance record. It is historical documentation, not a current development runbook.

## Documentation maintenance rule

When behavior changes, update the narrowest authoritative document in the same change:

- command/runtime changes -> `README.md`, `local-development.md`, `validation.md`;
- security or lifecycle semantics -> `runtime-invariants.md` and, when unresolved, `known-limitations.md`;
- deployment controls -> `resource-envelope.md`;
- benchmark protocol -> `benchmarks/README.md`;
- OpenCode session assumptions -> `session-lifecycle.md`.

Avoid duplicating long procedures across several files. Prefer links back to the authoritative runbook or contract.
