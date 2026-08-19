# RLM process resource envelope

The generated-code Worker has `permissions: "none"`, and the trusted Deno transport also carries a host-owned V8 old-space limit. Neither mechanism is an OS-level CPU/RSS/process-tree boundary. Deployments that require a hard resource guarantee must apply the limit to the **entire OpenCode/RLM service cgroup or container**, not only to the Deno child.

## Reference hard envelope

For a dedicated single-user OpenCode/RLM service, the reference starting profile is:

- hard memory/RSS boundary: **1536 MiB** for the complete service process tree;
- swap allowance: **0 MiB**;
- CPU quota: **2 logical CPUs** (`200%` of one CPU);
- process/thread task ceiling: **64**;
- RLM application watchdog: the existing **120 s** maximum per `rlm_exec` remains independently authoritative.

These are deployment limits, not hidden plugin defaults. Operators with larger model-hosting or concurrent-session requirements must deliberately choose and validate a larger envelope rather than weakening generated-code permissions or RLM budgets.

A systemd/cgroup-v2 deployment can express the reference profile with equivalent service controls such as:

```ini
[Service]
MemoryMax=1536M
MemorySwapMax=0
CPUQuota=200%
TasksMax=64
```

A container runtime may use equivalent memory, swap, CPU and PID limits. The boundary must include OpenCode and every RLM child process so a Deno transport cannot escape accounting by spawning outside the controlled process tree.

## Failure semantics

External termination of the trusted transport is not a valid RLM result. Production `executeRlmExec()` waits for the transport exit, requires exit code 0 plus an authenticated final protocol result, and otherwise returns `RUNTIME_ERROR`. Its `finally` path kills any still-running transport, closes stdin and cleans per-exec state. Turn wall reservation is finalized on both success and failure.

The host regression `plugin/tests-host/process-envelope.test.mjs` substitutes a deterministic transport that terminates with exit code 137. It verifies that no result is accepted, `RUNTIME_ERROR` is returned and the reserved turn wall budget is released.

## Machine-readable cgroup-v2 evidence

On a Linux cgroup-v2 deployment, capture the configured envelope for the service root PID with:

```sh
npm run verify:resource-envelope -- --root-pid <service-root-pid>
```

`scripts/verify-resource-envelope.mjs` reads the service process's unified cgroup membership, resolves the matching cgroup-v2 mount, and validates the reference controls exactly:

- `memory.max = 1610612736` bytes (1536 MiB);
- `memory.swap.max = 0`;
- `cpu.max` quota/period ratio = `2`;
- `pids.max = 64`.

It also snapshots the service root PID and all descendants visible in the verifier's PID namespace, requiring every observed descendant cgroup to remain at or below the service root cgroup. When available, `memory.current` and `pids.current` are recorded and checked against their hard maxima. The command emits a versioned JSON evidence record and exits with status `1` when any envelope check fails; discovery/usage errors exit with status `2`.

For durable deployment evidence, save the JSON output together with the exact RLM revision and deployment identifier. Run the verifier from a context that can see the service PID namespace and cgroup-v2 mount; a PID hidden by another namespace cannot be validated by this command.

This verifier is a **configuration/snapshot check**. It does not itself consume resources until the kernel kills a process, and therefore does not satisfy the deliberate termination/recovery portion of the deployment gate by itself.

## Deployment validation

Repository CI validates the failure contract, but cannot prove a production cgroup/container configuration. Before claiming a hard OS resource guarantee, the target deployment must:

1. run the full standalone gate inside its configured envelope;
2. capture a passing `verify:resource-envelope` record for the complete service process tree;
3. exercise at least one deliberate memory/CPU/process-limit termination;
4. confirm the same fail-closed RLM outcome and successful service recovery after that termination.

Only those target-runtime results can close the deployment validation gate.
