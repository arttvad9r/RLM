# RLM runtime invariants

These properties are security and correctness requirements rather than implementation details.

## Child lifecycle

- A parent abort must settle `callChildLlm()` locally even if an SDK/provider Promise never settles.
- A parent already aborted before child setup must not invoke SDK authority at all.
- Provider-side abort is best effort; synchronous throws or rejected abort Promises must not block local settlement.
- Every settled child call leaves the active RLM-child registry balanced.
- SDK responses are untrusted runtime data and malformed shapes fail closed with `CHILD_FAILED`.
- Provider error diagnostics must remain bounded and must not serialize arbitrary SDK error envelopes into model-visible errors.
- Child prompts receive a complete false-valued tool deny map.

## Turn authority and budgets

- A new user turn cannot become authoritative while any wall-reserved exec from the previous turn is active.
- Finishing one of several concurrent execs cannot release the user-turn transition early.
- Stale/non-authoritative turns cannot release or consume current-turn authority.
- Turn wall reservations and active-exec accounting are released on every production settlement path.

## Context authority

- Context access is rooted in host-owned authority; generated code cannot widen it.
- Hard-denied credential paths override any broad configured context policy.
- Credential matching is case-insensitive and `.env.example` is exempt only when it is the terminal path component.
- Symlink escapes resolved during confinement fail closed.

### Known pathname race limitation

`confinePath()` and the later `stat/open/opendir` operation are separate pathname operations. A hostile concurrent filesystem mutator can theoretically race a rename/symlink change between validation and use. Stable symlink escapes are covered, but portable descriptor-relative (`openat`/`O_NOFOLLOW`-style) traversal is still a separate hardening project and must not be represented as already solved.

## Protocol and sandbox

- Only authenticated per-exec runner frames are protocol data; unauthenticated stdout is ignored.
- Request IDs are bounded, unique for the exec lifetime, and total request state is bounded.
- Generated code does not receive OpenCode client/session authority or host filesystem/process handles.
- A parent request already aborted before `rlm_exec` setup must not reserve a turn or spawn the Deno transport.
- The trusted Deno transport must not inherit `DENO_PERMISSION_BROKER_PATH`; ambient broker authority cannot replace the runner's host-owned CLI permission envelope.
- Sandbox process settlement must be observed before a signal can be delivered, so timeout/root-abort cannot miss a signal-driven exit and remain pending.
- The application watchdog and deployment resource envelope are independent boundaries.

## Logging

Logging is diagnostic only. Logger rejection, synchronous throw, or a never-settling logger must not change tool lifecycle, cancellation, budget release, or returned results.
