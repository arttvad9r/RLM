# Standalone repository migration

The long-term home for OpenCode RLM should be a dedicated repository whose default branch contains only the standalone tree.

## Migration boundary

Use a **clean-root migration**, not a history-preserving push of the current branch ancestry. The source is the exact, fully validated tree at the chosen `rlm/standalone` commit. Create one new root commit in the target repository containing those bytes and record the source repository plus source commit SHA in the new repository README/release notes.

This boundary intentionally avoids carrying unrelated Autopilot ancestry into the standalone repository while preserving verifiable provenance through the source commit SHA and Git tree identity.

Do not use `rlm/integration`, `rlm/planner-ab-stage`, CI carrier branches or any downstream Planner/Autopilot branch as migration input.

## Target shape

The target default branch should contain the current standalone layout directly at repository root, including:

- `agent/rlm.md`;
- `plugin/**`;
- `benchmarks/**`;
- `docs/**`;
- `scripts/check-standalone.mjs`;
- `package.json` and `package-lock.json`;
- `.github/workflows/standalone-ci.yml`.

Set the new repository default branch to `main`. The existing standalone CI file can then use normal default-branch `workflow_dispatch`, push and pull-request validation without a carrier PR.

## Cutover sequence

1. Ensure there is no unfinished standalone RLM hardening PR whose changes are intended for the migration source.
2. Freeze an exact `rlm/standalone` source commit after its full `npm test` gate succeeds.
3. Record its commit SHA and Git tree SHA.
4. Create the dedicated repository and build a new root commit from exactly that source tree.
5. Confirm the new root tree SHA matches the frozen source tree SHA.
6. Run the full standalone CI from the new default branch with Node 24 and Deno 2.x.
7. Record the new repository root commit and successful workflow run.
8. Update standalone documentation to remove the non-default-branch CI-placement limitation and point downstream integrations at the new repository/revision.
9. Keep the old `rlm/standalone` branch read-only as provenance until consumers have migrated; do not delete historical RLM integration branches as part of this cutover.

## Authority boundary after migration

The dedicated repository remains runtime-only. Autopilot Planner/Worker/scheduler state, verifier authority, acceptance state and downstream model-routing policy stay outside it. Downstream projects consume a pinned standalone revision rather than adding project-specific authority back into the RLM repository.

## Required final evidence

Migration is complete only when all of the following are recorded together:

- source `rlm/standalone` commit SHA;
- source Git tree SHA;
- target root commit SHA;
- matching target Git tree SHA;
- full successful standalone CI run on the target default branch.
