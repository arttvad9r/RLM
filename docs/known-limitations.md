# Known limitations and hardening backlog

This document records boundaries that are not silently treated as solved. They require an explicit design change and validation rather than heuristic patches.

## Process-level resource boundary

The trusted Deno transport is started with a host-owned V8 old-space ceiling and the generated-code Worker has `permissions: "none"`. The V8 limit bounds the primary JavaScript heap but is not a complete RSS/CPU/process-tree isolation boundary.

`docs/resource-envelope.md` defines the supported OS-level deployment contract, a reference cgroup/container profile, and the fail-closed semantics for external transport termination. Repository CI verifies the production failure/cleanup behavior, but it cannot prove that a target deployment actually applies the required cgroup/container controls. Do not claim a hard OS resource guarantee until the target deployment has validated the full OpenCode/RLM process tree inside that envelope.

## Pathname confinement race

`confinePath()` canonicalizes and verifies a candidate path before context code later performs `stat`, `open`, or `opendir`. Those are separate pathname operations. Stable symlink escapes fail closed, but a hostile process with concurrent write authority inside the workspace could theoretically race a rename or symlink replacement between validation and use.

Closing this boundary portably requires descriptor-relative traversal (`openat`/`O_NOFOLLOW`-style semantics or an equivalent native helper) rather than another pathname heuristic. Until that design is implemented and validated, do not represent context confinement as resistant to a malicious concurrent filesystem mutator.

## Deno runtime compatibility gate

The trusted runner command explicitly disables project config, lockfile discovery, npm resolution and remote module resolution with `--no-config`, `--no-lock`, `--no-npm` and `--no-remote`. Its only Deno permission grant is scoped read access to the fixed generated Worker entry module; generated model code runs in a Worker with `permissions: "none"`.

Node-native host regressions can validate command construction, host policy, protocol and lifecycle logic without a Deno installation, but they are not a substitute for executing `deno check` and the Deno runtime regression suite on a supported Deno 2.x build. Changes to runner flags, Worker options or Deno-specific APIs require that full gate before compatibility is claimed.

## Validation evidence boundary

The dedicated repository now runs Standalone RLM CI from default branch `main`. The earlier non-default-branch CI placement limitation no longer applies.

Validation claims remain revision-specific. Until the relevant commands are actually executed on a concrete commit or tested merge tree, repository documentation must not describe that revision as passing typecheck, Deno runtime tests or benchmark integrity checks. A successful historical CI run is evidence only for the revision it validated.
