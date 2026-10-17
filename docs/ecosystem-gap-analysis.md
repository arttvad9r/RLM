# RLM ecosystem gap analysis

Updated: 2026-10-17

This document defines where this project should align with the wider Recursive Language Model ecosystem and where it should deliberately differ. The goal is to avoid rebuilding a weaker version of existing RLM frameworks.

## Positioning

This project is **not** intended to become a general-purpose model provider SDK, a standalone coding agent, or a replacement for the official RLM implementation or DSPy.

Its intended niche is:

> A small, host-neutral RLM capability layer for existing coding agents, with bounded repository context, isolated semantic children, explicit budgets, and model-generated code that has no ambient machine authority.

The host agent (Codex, OpenCode, or a future adapter) already supplies the outer reasoning/tool loop. RLM supplies a constrained context-computation runtime inside that loop.

## Sources reviewed

- Official RLM runtime and API: https://github.com/alexzhang13/rlm and https://github.com/alexzhang13/rlm/blob/main/docs/api/rlm.md
- DSPy RLM: https://github.com/stanfordnlp/dspy/blob/main/docs/docs/api/modules/RLM.md and https://github.com/stanfordnlp/dspy/blob/main/dspy/predict/rlm.py
- Prime Agent RLM programming model: https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/rlm.md
- Prime Agent runtime architecture: https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/rlm-runtime.md
- lambda-RLM research direction: https://arxiv.org/abs/2603.20105 and https://github.com/lambda-calculus-LLM/lambda-RLM

These projects have different goals. A feature being present elsewhere is not by itself a reason to add it here.

## Architecture comparison

| Area | This project | Official RLM | DSPy.RLM | Prime Agent | lambda-RLM | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| Outer agent loop | Existing host agent | RLM-owned iterative loop | RLM-owned iterative loop | Prime Agent-owned loop | Structured runtime | **Keep host-owned** |
| Model code environment | One-shot zero-permission JS Worker | Persistent Python REPL per completion; optional cross-completion persistence | Sandboxed Python REPL per invocation | Persistent Python kernel | Typed combinators | **Keep isolated JS execution** |
| Long context | Host-mediated repository capabilities | Prompt/context as REPL variable | Inputs as REPL variables | Files/data via persistent Python environment | Split/peek combinators | **Repository capability API is a differentiator** |
| Plain child LM calls | Yes | Yes | Yes | Full child agents | Leaf LM calls | Keep |
| Separate cheaper child model | Not yet | Multiple/sub backends supported | `sub_lm` supported | Model selection for spawned agents | Runtime-dependent | **Add** |
| True recursive child RLM | No | `rlm_query`, configurable depth | Nested RLM/sub-agents | Recursive subagents | Explicit recursive plan | **Optional later, benchmark first** |
| Batched calls | Yes, currently 1-4 | Batched plain and recursive calls | Batched calls, budget up to many calls | Parallel spawned agents | MAP | **Raise total budget; keep bounded concurrency** |
| Working state | Turn-scoped JSON memory | REPL variables/history; optional persistent sessions | REPL state during invocation | Durable kernel + harness state | Symbolic intermediate values | **Keep bounded turn memory; no durable memory by default** |
| Custom tools | Fixed context/memory/LLM capabilities | Arbitrary custom tools/sub-tools | User tools and DSPy subagents | Skills, shell, host requests | Fixed combinator library | **Do not expose arbitrary host tools; consider typed approved capabilities only** |
| Generated-code authority | No FS/network/env/subprocess/FFI | Depends on environment; local mode shares host process | Depends on interpreter | Kernel is explicitly not a security sandbox | Constrained functional runtime | **Core differentiator; preserve** |
| Provider abstraction | Delegated to host | Built in | DSPy LM layer | Built in to agent | Separate concern | **Do not build one** |
| Compaction | Host responsibility | Built in | RLM trajectory/fallback mechanisms | Built in | Not central | **Do not duplicate host compaction** |
| Durable agent memory/goals | Host responsibility | Persistent REPL option | Outside core RLM | Continual Harness, goals, skills | Not central | **Out of scope** |
| Background agents/scheduling | Host responsibility | No core need | No core need | Built in | No | **Out of scope** |
| Training/RL | No | Training harness | DSPy optimization ecosystem | PRIME-RL ecosystem | Research runtime | **Out of scope** |
| Trajectory observability | Per-exec metadata, incomplete host surfacing | Full trajectory logger/visualizer | DSPy histories/usage | Rich session/subagent state | Deterministic plan | **Improve** |
| Structured orchestration | Free-form JavaScript | Free-form Python | Free-form Python | Free-form Python | SPLIT/MAP/FILTER/REDUCE/etc. | **Add a bounded structured layer alongside JS** |
| Existing coding-agent adapters | Codex + OpenCode | Not its primary purpose | Not its primary purpose | It is the agent | No | **Primary product surface** |

## What is genuinely missing

### 1. Child call budgeting is currently too artificial

Current hard limits are `MAX_SUBCALLS_TOTAL = 4`, `MAX_SUBCALLS_CONCURRENT = 4`, and `MAX_CHILD_CALLS_PER_TURN = 8`.

The important safety control is **concurrency and aggregate turn budget**, not an arbitrary total of four calls. Other RLM runtimes routinely allow substantially more sub-LM calls while bounding concurrency and total usage.

We should separate:

- total child calls allowed in one execution;
- maximum simultaneous child calls;
- total child calls allowed in one root turn;
- token/cost/wall budgets when the host exposes reliable accounting.

`llm.batch()` should accept more prompts than the concurrency ceiling and let the runtime queue them in bounded waves.

### 2. Child model policy

Children currently inherit the exact root model/variant. That is the correct default for predictable behavior and fair architecture benchmarks, but not the best production policy.

Add host-neutral policies:

- `inherit` — current behavior and benchmark default;
- `fixed` — use an explicitly configured cheaper child provider/model/variant;
- `adaptive` — only after `fixed` is proven useful; cheap-first with controlled escalation.

Every run must record the exact root and child model identities used.

### 3. Structured orchestration beside free-form JavaScript

Diagnostic benchmarks showed weaker models can fail before RLM logic even runs by generating syntactically invalid nested JavaScript. lambda-RLM attacks the same class of problem by replacing arbitrary control flow with a small compositional vocabulary.

Do not replace `rlm_exec`. Add a safer structured path for common large-context work, for example:

- partition/chunk;
- semantic map/classify/extract;
- filter;
- deterministic deduplicate/sort;
- reduce/merge;
- optional verify stage.

The exact API needs design work. The important property is that routing/control flow can be validated before child inference starts.

### 4. Better first-class telemetry

The runtime already collects per-exec counts, context characters, child token totals, memory operations, child session IDs, wall time and turn-budget snapshots. Some hosts do not expose nested tool metadata cleanly enough for benchmark collection.

Promote telemetry to a stable host-neutral evidence contract rather than relying on host UI nesting. It should include:

- root turn/run identity;
- exact root/child model identities;
- child call count and outcomes;
- context/memory operations and bytes/chars;
- token/cache/cost accounting when available;
- wall time and termination reason;
- no prompts, secrets, file contents or memory values by default.

### 5. Optional recursive RLM calls

The official runtime distinguishes cheap `llm_query()` from recursive `rlm_query()` where a child gets its own REPL/iterations. DSPy can now build nested RLM/subagents as well.

This is a real semantic gap, but it is **not P0**. Existing coding agents already provide a strong outer loop, and recursively granting a child another RLM runtime increases cost, lifecycle complexity and security surface.

Only add a bounded `rlm()`/recursive-child capability if benchmarks demonstrate tasks where plain semantic children plus root orchestration are materially worse. Default recursion depth should remain zero/disabled.

## What looks like a gap but is intentionally not one

### Persistent REPL

Official RLM and Prime Agent keep Python variables/functions/imports alive across code cells. In this project, the host coding agent already owns the iterative reasoning loop. Re-implementing another autonomous root REPL loop inside `rlm_exec` would duplicate that host.

`memory.*` supplies the missing data continuity across separate zero-permission sandbox executions without preserving executable capabilities or ambient authority.

A persistent unrestricted Python kernel would weaken the current security model and is not required for the adapter use case.

### Durable cross-turn memory

Prime Agent's Continual Harness is a full agent-memory/skills system. This project should not compete with it. Durable memory introduces retrieval, invalidation, poisoning, privacy and lifecycle policy that belongs to the host agent.

RLM working memory should remain bounded scratch state unless a future host adapter explicitly maps a host-owned durable-memory capability.

### Arbitrary custom tools

Official RLM and DSPy allow custom tools in the REPL. Our fixed capability boundary is intentional. Giving model-generated code arbitrary host callables would erase one of the project's clearest security properties.

If extensibility becomes necessary, use a typed allowlisted capability registry with per-capability budgets and host authorization. Do not pass raw host objects/functions into generated code.

### Provider framework

Official RLM already supports major providers, DSPy has its LM layer, and coding agents already own authentication/model selection. The RLM core should consume a narrow `RlmHost.callChild` interface and let adapters translate host semantics.

### Sandbox provider zoo

Official RLM supports local, IPython, Docker and multiple cloud sandboxes. Our product value is a small predictable local authority boundary, not sandbox vendor selection. External cgroup/container deployment remains a host/operator concern.

### Training framework

The official project already has RLM training infrastructure, and DSPy provides optimization machinery. Training is outside the scope of an adapter/runtime project.

## Differentiators worth protecting

1. **Existing-agent integration.** Codex/OpenCode remain the root agent; RLM is a capability, not a competing agent shell.
2. **Host-neutral core.** Turn identity and child execution are adapter concerns behind a narrow interface.
3. **Capability-mediated repository context.** Generated code receives bounded read/search operations rather than a giant prompt variable or filesystem handle.
4. **Zero-permission generated-code realm.** No filesystem, network, environment, subprocess or FFI authority.
5. **Isolated semantic children.** Children receive focused prompts rather than repository/tool/history authority.
6. **Authoritative turn budgets.** Budget and working-memory identity come from the host, not model-supplied IDs.
7. **Bounded external working memory.** Intermediate JSON can stay outside the root conversation without becoming durable executable state.
8. **Auditable benchmark/security evidence.** The repository already treats benchmark identity, source snapshots and resource/security claims as evidence rather than marketing assertions.

## Product boundary

A useful litmus test for future features:

- If the feature makes **Codex/OpenCode better at bounded large-context computation without replacing them**, it probably belongs here.
- If the feature turns this repository into another complete coding agent, provider SDK, long-term memory platform, sandbox marketplace or RL framework, it probably belongs elsewhere.

## Current conclusion

We are not building a novel RLM paradigm. The paradigm and general runtimes already exist.

The defensible project is narrower: **a secure, portable RLM capability runtime that existing coding agents can adopt without handing model-generated orchestration code ambient machine authority**.

The roadmap should optimize for that boundary rather than feature parity with official RLM, DSPy or Prime Agent.
