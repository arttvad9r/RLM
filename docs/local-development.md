# Local development and acceptance runbook

This is the authoritative local workflow for validating RLM changes. The goal is to separate repository synchronization, fast host feedback, the Deno sandbox boundary, the reproducible container gate, real OpenCode integration, benchmark evidence, and deployment resource evidence.

A result is evidence only for the exact Git commit that was tested.

## 1. Synchronize the local checkout with GitHub before doing any development

The local checkout and GitHub branch may contain materially different work. Do **not** assume either side is canonical and do not start dependency installation, Nix work, tests, refactors, or bug fixes until both histories have been inspected and reconciled.

First record the local state without modifying it:

```sh
pwd
git rev-parse --show-toplevel
git remote -v
git status --short --branch
git branch --show-current
git rev-parse HEAD
git log --oneline --decorate -20
git diff
git diff --staged
git ls-files --others --exclude-standard
```

Verify that `origin` is the expected `arttvad9r/RLM` repository. If it is not, stop and resolve the remote identity rather than rewriting it blindly.

### Preserve local work before fetching/integrating

If the worktree contains uncommitted tracked or untracked changes, create recoverable local state before integration. Use a uniquely named backup branch for the current commit and a stash including untracked files:

```sh
git branch backup/pre-sync-<timestamp> HEAD
git stash push -u -m "pre-sync safety snapshot"
git stash list
git status --short
```

Do not use `git reset --hard`, `git clean -fd`, `git restore .`, or another destructive shortcut to make the worktree clean.

If the worktree is already clean, still record the starting branch and SHA in the final report.

### Fetch the real GitHub state

```sh
git fetch --all --prune
git remote show origin
git branch -vv
git status --short --branch
```

For the current hardening work, inspect both `origin/main` and `origin/fix/consolidate-audit-hardening` when that feature branch exists:

```sh
git rev-parse origin/main
git rev-parse origin/fix/consolidate-audit-hardening
git merge-base HEAD origin/fix/consolidate-audit-hardening
git rev-list --left-right --count HEAD...origin/fix/consolidate-audit-hardening
git log --oneline --left-right --graph HEAD...origin/fix/consolidate-audit-hardening
```

Adapt the branch name when the active local work belongs to a different branch. If `gh` is available, read-only inspection of the repository/PR is also useful:

```sh
gh repo view
gh pr view 30
```

### Classify the divergence before changing history

Establish which case applies:

- local and remote are identical;
- local is only behind remote;
- local is only ahead of remote;
- local and remote have diverged;
- the relevant work lives on another local branch;
- any of the above plus previously stashed uncommitted work.

Inspect local-only and remote-only commits before integrating:

```sh
git log --oneline origin/<branch>..HEAD
git log --oneline HEAD..origin/<branch>
git diff --stat HEAD..origin/<branch>
git diff --stat origin/<branch>..HEAD
```

### Integrate without destroying either side

If local is only behind, use a fast-forward:

```sh
git merge --ff-only origin/<branch>
```

If local and remote diverged, inspect both sets of commits and preserve both. Prefer a normal merge on the working feature branch or a temporary integration branch when that is clearer. Do not use `reset --hard`, force push, or blindly choose `ours`/`theirs` for conflicts.

If the local commits are unpublished and a rebase would appear convenient, do not rewrite them merely for cleanliness during synchronization. Preserve history unless there is a deliberate, separately reviewed reason to rewrite it.

After integration, restore any safety stash with `git stash apply`, not `pop`, resolve conflicts semantically, and verify the result before deleting the safety copy.

```sh
git stash apply <stash>
git status
git diff
git diff --staged
```

### Make local and GitHub agree before development starts

The synchronization stage is complete only when the intended feature branch contains all relevant local and GitHub work and its state is understood. If synchronization requires publishing local-only integration commits to the feature branch, use an ordinary non-force push only after reviewing the exact commits/diff being published:

```sh
git fetch origin
git rev-list --left-right --count HEAD...origin/<branch>
git log --oneline origin/<branch>..HEAD
git push origin HEAD:<branch>
```

Never use `--force` or `--force-with-lease` for this synchronization. Do not merge the pull request, close it, mark it ready, delete branches, or alter unrelated GitHub metadata as part of local synchronization.

Immediately after the push, fetch again and require:

```sh
git fetch origin
git rev-list --left-right --count HEAD...origin/<branch>
```

to report `0 0` for the synchronized branch. If another actor moved the remote branch in the meantime, stop, fetch, and reconcile again instead of overwriting it.

Only after this point should environment setup, dependency installation, tests, Nix work, or code changes begin.

## 2. Establish the revision under test

Once synchronization is complete, record the exact clean revision that will be validated:

```sh
git status --short
git rev-parse HEAD
git branch --show-current
git log -1 --oneline
```

Do not validate from a mixed worktree and later attribute the result to `HEAD`.

## 3. Runtime prerequisites

Supported development baseline:

- Node.js 24.x;
- Deno 2.x;
- npm from the Node 24 installation;
- Git;
- Docker for the reproducible container gate;
- OpenCode plus valid model-provider credentials for the integration smoke test.

The repository/container validation baseline is pinned to Node `24.19.0` and Deno `2.9.5`.

Check the machine:

```sh
node --version
npm --version
deno --version
git --version
docker version
node scripts/check-runtime.mjs --exact
```

`--exact` is the preferred acceptance check. Ordinary development may use another Node 24.x / Deno 2.x combination, but that is compatibility coverage rather than exact-baseline evidence.

### NixOS note

On NixOS, prefer a project-local/reproducible shell (`nix develop`, `nix shell`, or an intentionally maintained project flake) instead of globally installing development runtimes. The runtime contract remains Node 24.x + Deno 2.x, while the exact container baseline remains Node `24.19.0` + Deno `2.9.5`.

If the synchronized branch does not yet contain a maintained `flake.nix`, adding one is a development task **after** repository synchronization, not part of the synchronization itself. Do not modify `/etc/nixos/configuration.nix` merely to validate RLM.

## 4. Install the pinned npm graph

```sh
rm -rf node_modules
npm ci --ignore-scripts
git status --short
```

The install should not modify tracked files. Do not replace `npm ci` with an opportunistic dependency upgrade during baseline validation.

## 5. Run the fast host gate first

```sh
npm run gate:host
```

This covers the standalone-tree guard, Node-native host/runtime regressions, host TypeScript, benchmark harness tests, and committed benchmark integrity.

If this fails, stop and diagnose the failure before moving to Deno/OpenCode integration. Do not weaken limits or delete a regression merely to make the gate green.

## 6. Exercise the Deno boundary explicitly

Run the Deno-specific checks separately so failures are easy to localize:

```sh
npm run typecheck:runner
npm run test:plugin
```

Pay particular attention to runner/Worker permission isolation, authenticated protocol behavior, host-EOF handling, generated-code error normalization, and direct filesystem/network/process denial.

## 7. Run the authoritative native local gate

```sh
npm run gate:local
```

This performs `check:runtime` and then the complete repository `npm test` sequence.

A merge-readiness claim requires this gate to pass on the exact revision under review unless the project explicitly adopts another stronger gate.

## 8. Run the reproducible container gate

With Docker available:

```sh
npm run gate:container
```

The container uses the exact repository baseline: Node `24.19.0` plus Deno `2.9.5`, installs with `npm ci --ignore-scripts`, checks exact runtime versions, and runs `npm test`.

Native and container success are complementary evidence. A container pass does not replace real OpenCode integration, and a native pass does not prove deployment cgroup enforcement.

## 9. Real OpenCode smoke test

Run this in a disposable Git workspace, not against secrets or an important repository.

Suggested fixture:

```sh
mkdir -p ~/rlm-smoke/src
cd ~/rlm-smoke
git init
printf 'ordinary context\n' > normal.txt
printf 'export const value = 42\n' > src/example.ts
printf 'TOP_SECRET=must-not-read\n' > .env
printf '%s\n' 'must-not-read' > secret.pem
ln -s /etc escape
```

Install/load the repository plugin using the OpenCode local-plugin mechanism appropriate for the installed OpenCode version. Keep the RLM source revision fixed while doing the baseline smoke test.

Verify at least these behaviors through `rlm_exec`:

1. basic execution returns a deterministic value, for example `2 + 2`;
2. `context.read("normal.txt")` returns the file content;
3. reading `.env` and `secret.pem` fails with context denial;
4. `context.read("escape/passwd")` fails rather than following the symlink outside the approved root;
5. generated code has no usable `Deno`, `process`, `Worker` or `MessageChannel` ambient authority;
6. a network attempt such as `fetch("https://example.com")` is denied;
7. one `llm(...)` child call returns text and metadata without exposing ordinary OpenCode tools;
8. `llm.batch(...)` with four independent prompts settles without deadlock;
9. cancel a deliberately non-settling `rlm_exec`, then immediately run a new small `rlm_exec` and confirm lifecycle/budget state was released.

Record the OpenCode version, plugin/SDK package versions, model/provider, RLM commit SHA, and smoke-test result.

## 10. OpenCode SDK compatibility procedure

The repository intentionally pins `@opencode-ai/plugin` and `@opencode-ai/sdk`. First establish a passing baseline with those pinned versions.

Only after the baseline is green should compatibility with newer packages be tested, preferably on a separate branch:

```sh
npm view @opencode-ai/plugin version
npm view @opencode-ai/sdk version
```

If an upgrade is being evaluated, update both packages deliberately, keep them exact-pinned, rerun `gate:local`, `gate:container`, and the real OpenCode smoke test, and review lifecycle/tool-hook behavior. Do not mix an SDK migration into an unrelated runtime-hardening change.

## 11. Benchmark acceptance

Repository benchmark tests verify the evaluator and frozen fixtures. They do not prove that RLM improves model performance.

For a real effectiveness decision, execute four provider/model-matched arms:

- 192-file normal agent;
- 192-file RLM agent;
- 384-file normal agent;
- 384-file RLM agent.

Keep source revision, task prompt, model/provider/variant and experiment configuration identical except for RLM availability. Do not expose ground truth or manifests to the model during inference. The RLM arm must record actual `rlm_exec` use.

Score and compare with the harness documented in [`../benchmarks/README.md`](../benchmarks/README.md). Preserve raw run records, score records, comparison output, token/cost telemetry and wall time.

Continue development based on measured quality/scaling/cost behavior, not on the existence of the benchmark harness alone.

## 12. Deployment resource gate

On a Linux/cgroup-v2 target, apply the process-tree envelope from [`resource-envelope.md`](resource-envelope.md), then capture machine-readable evidence:

```sh
npm run verify:resource-envelope -- --root-pid <service-root-pid>
```

A production resource claim additionally requires deliberate resource-limit termination and successful service recovery. The verifier alone is a configuration/snapshot check.

## 13. Evidence capture

For a serious acceptance run, save at least:

```sh
git rev-parse HEAD
node --version
deno --version
npm --version
opencode --version
```

and the output/exit status of:

```sh
npm run gate:host
npm run typecheck:runner
npm run test:plugin
npm run gate:local
npm run gate:container
```

Also record the repository synchronization evidence (`local start SHA`, `remote start SHA`, local-only/remote-only commit counts, integration method, final synchronized SHA), the real OpenCode smoke result and, when applicable, benchmark and cgroup evidence.

Do not summarize a partial run as "all tests passed".

## 14. Stop conditions

Do not begin development when local and GitHub state has not been reconciled and documented.

Do not mark a hardening revision merge-ready when any of the following is true:

- the intended local feature branch and `origin/<branch>` are still divergent;
- `gate:local` has not run successfully on the exact revision;
- Deno-specific tests were skipped;
- an OpenCode API/SDK change is being assumed compatible without a real smoke test;
- benchmark value is being claimed without real normal/RLM arms;
- a hard OS resource guarantee is being claimed without target cgroup/container evidence;
- the pathname TOCTOU limitation in [`known-limitations.md`](known-limitations.md) is being described as solved.

Hosted CI that fails before recording any workflow step is infrastructure evidence only. It must not be reported as a repository test failure or as a passing validation result.
