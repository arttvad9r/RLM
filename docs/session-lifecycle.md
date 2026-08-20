# RLM session lifecycle

## Semantic child retention

RLM keeps completed semantic child sessions after `llm()` / `llm.batch()` returns so the OpenCode session tree retains trace/debug evidence. The plugin does not delete completed children eagerly.

Every child is created with `parentID` equal to the root session ID. In the pinned OpenCode `1.1.26` baseline, deleting a session recursively deletes its child sessions before removing the parent and publishing `session.deleted`. Therefore completed RLM children have the same maximum storage lifetime as their root session and are removed by the host's normal root-session deletion lifecycle.

The OpenCode host/operator owns root-session retention policy and storage lifetime. RLM owns only the active-child registry used while a child is executing; that registry is always cleaned in `finally` and is not the persistence mechanism for completed sessions.

Do not add a second plugin-owned completed-child registry or eager deletion loop unless the pinned OpenCode parent/recursive-delete contract changes. An OpenCode version change that affects session parenting or deletion requires the full compatibility gate before this retention policy is claimed.

## Root deletion and active execution

The authoritative `session.deleted` event evicts the matching turn-governor cache so deleted session authority cannot be resurrected or used by later child/context requests.

Cancellation of an already-running `rlm_exec` is primarily owned by the abort signal supplied by the OpenCode host and propagated through the sandbox/child lifecycle. RLM does not currently claim an independently validated second cancellation owner that kills an active sandbox solely from the `session.deleted` event.

Do not add event-driven active-exec cancellation heuristically. It must first be validated against real OpenCode event/abort ordering so the plugin does not introduce double-cancellation, premature cleanup, or races with the existing host abort path. This boundary is tracked in [`known-limitations.md`](known-limitations.md).
