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

## Deployment validation

Repository CI validates the failure contract, but cannot prove a production cgroup/container configuration. Before claiming a hard OS resource guarantee, the target deployment must run the full standalone gate inside its configured envelope and exercise at least one deliberate memory/CPU/process-limit termination while confirming the same fail-closed outcome and service recovery behavior.
