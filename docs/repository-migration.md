# Completed standalone repository migration

OpenCode RLM now lives in the dedicated repository `arttvad9r/RLM` on default branch `main`.

## Migration record

The standalone source was frozen and validated in the Autopilot repository before cutover.

- source repository: `arttvad9r/Opencode-Autopilot`;
- source branch: `rlm/standalone`;
- source commit: `f72b1fda78ef03d47a4278d2f16687550d5927fe`;
- source Git tree: `0ea96ee9a9b979d1d7cce506f597dc5c277e719e`;
- target repository: `arttvad9r/RLM`;
- target default branch: `main`;
- target migration/finalization commit: `16e53467a0f22f370056d66c8992dded7dc98f1f`;
- target Git tree at that commit: `ce25647c17682b93c83e9fac988f0ad7f244b7ef`;
- first target default-branch Standalone RLM CI run: `32228268021` (`success`).

The target repository does not carry Autopilot development ancestry. It did contain temporary target-owned bootstrap/transport commits because the available migration path could not create a parentless Git root commit directly. Those commits are target provisioning history, not imported Autopilot history.

## Source-tree and target-tree identity

The frozen source tree and the finalized target tree are different identities and must be recorded separately.

`0ea96ee9a9b979d1d7cce506f597dc5c277e719e` is the certified standalone source tree used for the migration. The target migration/finalization commit also applies target-owned repository changes, including adapting standalone CI from the historical `rlm/standalone` branch to target `main` and removing temporary migration scaffolding. Its tree is therefore `ce25647c17682b93c83e9fac988f0ad7f244b7ef` rather than the source tree SHA.

Do not describe the finalized target tree as byte-identical to the source tree. Provenance is established by the explicit source commit/tree record, the bounded standalone contents imported from that source, the target migration commit, and target CI validation.

## Target shape

The dedicated repository owns only the standalone RLM surface:

- `agent/rlm.md`;
- `plugin/**`;
- `benchmarks/**`;
- `docs/**`;
- `scripts/check-standalone.mjs`;
- standalone package/TypeScript configuration;
- `.github/workflows/standalone-ci.yml`.

`scripts/check-standalone.mjs` fails closed on known Autopilot tree/path coupling and unexpected top-level entries.

## Authority boundary after migration

The dedicated repository remains runtime-only. Autopilot Planner/Worker/scheduler state, verifier authority, acceptance state and downstream model-routing policy stay outside it. Downstream projects consume an explicit standalone revision rather than adding project-specific authority back into this repository.

Historical Autopilot branches such as `rlm/integration` and `rlm/planner-ab-stage` are provenance only. They are not valid integration bases for future work and their embedded-RLM source-copy pattern must not be revived.

## Validation boundary

The target default branch has its own Standalone RLM CI using Node 24 and Deno 2.x and runs the repository `npm test` gate. A passing claim for any later revision must refer to an actual validation run for that revision; the successful migration run above is evidence for the migration commit, not an evergreen claim for future commits.
