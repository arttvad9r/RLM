# Local development and acceptance runbook

This is the authoritative local workflow for validating RLM changes. The goal is to separate fast host feedback from the Deno sandbox boundary, the reproducible container gate, real OpenCode integration, benchmark evidence, and deployment resource evidence.

A result is evidence only for the exact Git commit that was tested.

## 1. Establish the revision under test

Start from a clean worktree and record the commit before doing anything else:

```sh
git status --short
git rev-parse HEAD
git branch --show-current
```

Do not validate from a mixed worktree and later attribute the result to `HEAD`.

For acceptance of a pull request, check out its actual head branch and use `git pull --ff-only`. Do not rebase, squash, or rewrite the branch merely to run tests.

## 2. Runtime prerequisites

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

The repository does not require a project-local Nix flake to run its gates. It is valid to provide Node 24, Deno 2, Git and Docker through the host NixOS configuration, `nix shell`, `nix develop` from external tooling, or another trusted package source. Keep local environment scaffolding out of the repository unless it is intentionally being added as a maintained project interface.

## 3. Install the pinned npm graph

```sh
rm -rf node_modules
npm ci --ignore-scripts
git status --short
```

The install should not modify tracked files. Do not replace `npm ci` with an opportunistic dependency upgrade during baseline validation.

## 4. Run the fast host gate first

```sh
npm run gate:host
```

This covers the standalone-tree guard, Node-native host/runtime regressions, host TypeScript, benchmark harness tests, and committed benchmark integrity.

If this fails, stop and diagnose the failure before moving to Deno/OpenCode integration. Do not weaken limits or delete a regression merely to make the gate green.

## 5. Exercise the Deno boundary explicitly

Run the Deno-specific checks separately so failures are easy to localize:

```sh
npm run typecheck:runner
npm run test:plugin
```

Pay particular attention to runner/Worker permission isolation, authenticated protocol behavior, host-EOF handling, generated-code error normalization, and direct filesystem/network/process denial.

## 6. Run the authoritative native local gate

```sh
npm run gate:local
```

This performs `check:runtime` and then the complete repository `npm test` sequence.

A merge-readiness claim requires this gate to pass on the exact revision under review unless the project explicitly adopts another stronger gate.

## 7. Run the reproducible container gate

With Docker available:

```sh
npm run gate:container
```

The container uses the exact repository baseline: Node `24.19.0` plus Deno `2.9.5`, installs with `npm ci --ignore-scripts`, checks exact runtime versions, and runs `npm test`.

Native and container success are complementary evidence. A container pass does not replace real OpenCode integration, and a native pass does not prove deployment cgroup enforcement.

## 8. Real OpenCode smoke test

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

## 9. OpenCode SDK compatibility procedure

The repository intentionally pins `@opencode-ai/plugin` and `@opencode-ai/sdk`. First establish a passing baseline with those pinned versions.

Only after the baseline is green should compatibility with newer packages be tested, preferably on a separate branch:

```sh
npm view @opencode-ai/plugin version
npm view @opencode-ai/sdk version
```

If an upgrade is being evaluated, update both packages deliberately, keep them exact-pinned, rerun `gate:local`, `gate:container`, and the real OpenCode smoke test, and review lifecycle/tool-hook behavior. Do not mix an SDK migration into an unrelated runtime-hardening change.

## 10. Benchmark acceptance

Repository benchmark tests verify the evaluator and frozen fixtures. They do not prove that RLM improves model performance.

For a real effectiveness decision, execute four provider/model-matched arms:

- 192-file normal agent;
- 192-file RLM agent;
- 384-file normal agent;
- 384-file RLM agent.

Keep source revision, task prompt, model/provider/variant and experiment configuration identical except for RLM availability. Do not expose ground truth or manifests to the model during inference. The RLM arm must record actual `rlm_exec` use.

Score and compare with the harness documented in [`../benchmarks/README.md`](../benchmarks/README.md). Preserve raw run records, score records, comparison output, token/cost telemetry and wall time.

Continue development based on measured quality/scaling/cost behavior, not on the existence of the benchmark harness alone.

## 11. Deployment resource gate

On a Linux/cgroup-v2 target, apply the process-tree envelope from [`resource-envelope.md`](resource-envelope.md), then capture machine-readable evidence:

```sh
npm run verify:resource-envelope -- --root-pid <service-root-pid>
```

A production resource claim additionally requires deliberate resource-limit termination and successful service recovery. The verifier alone is a configuration/snapshot check.

## 12. Evidence capture

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

Also record the real OpenCode smoke result and, when applicable, benchmark and cgroup evidence.

Do not summarize a partial run as "all tests passed".

## 13. Stop conditions

Do not mark a hardening revision merge-ready when any of the following is true:

- `gate:local` has not run successfully on the exact revision;
- Deno-specific tests were skipped;
- an OpenCode API/SDK change is being assumed compatible without a real smoke test;
- benchmark value is being claimed without real normal/RLM arms;
- a hard OS resource guarantee is being claimed without target cgroup/container evidence;
- the pathname TOCTOU limitation in [`known-limitations.md`](known-limitations.md) is being described as solved.

Hosted CI that fails before recording any workflow step is infrastructure evidence only. It must not be reported as a repository test failure or as a passing validation result.
