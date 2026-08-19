# RLM session lifecycle

## Semantic child retention

RLM keeps completed semantic child sessions after `llm()` / `llm.batch()` returns so the OpenCode session tree retains trace/debug evidence. The plugin does not delete completed children eagerly.

Every child is created with `parentID` equal to the root session ID. In the pinned OpenCode `1.1.26` implementation, deleting a session recursively deletes its child sessions before removing the parent and publishing `session.deleted`. Therefore completed RLM children have the same maximum storage lifetime as their root session and are removed by the host's normal root-session deletion lifecycle.

The OpenCode host/operator owns root-session retention policy and storage lifetime. RLM owns only the active-child registry used while a child is executing; that registry is always cleaned in `finally` and is not the persistence mechanism for completed sessions.

Do not add a second plugin-owned completed-child registry or eager deletion loop unless the pinned OpenCode parent/recursive-delete contract changes. An OpenCode version change that affects session parenting or deletion requires the full compatibility gate before this retention policy is claimed.
