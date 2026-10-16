# Contributing

RLM is security-sensitive runtime code. Contributions should make authority, lifecycle and resource limits more explicit rather than more implicit.

## Setup

Requirements: Node.js 24+ and Deno 2.x.

```bash
npm ci --ignore-scripts
```

## Required verification

Run the full gate before claiming a runtime change is complete:

```bash
npm test
```

For focused development the individual commands are documented in `README.md`, but a passing subset is not evidence that the full sandbox path passes.

## Invariants

- Generated code must not gain direct filesystem, network, environment, subprocess or FFI authority.
- Context access stays host-mediated, read-only and bounded.
- Session/turn identity failures remain fail-closed.
- Child agents do not inherit ordinary OpenCode tools or unrelated conversation/repository context.
- New limits need explicit accounting and regression tests.
- Changes to a trust boundary should update `docs/known-limitations.md` and the relevant security tests.

Keep pull requests small and state exactly which validation commands were run.
