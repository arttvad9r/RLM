# Security policy

RLM deliberately executes model-generated orchestration inside a constrained runtime. Sandbox escapes, authority widening and budget-reset bugs are security issues.

## Reporting

Do not publish working sandbox escapes, sensitive host paths, credentials or exploit chains in a public issue. Use GitHub's private vulnerability-reporting channel when available; otherwise contact the repository owner through GitHub first and request a private channel.

## High-priority issues

Examples include:

- generated code obtaining filesystem, network, environment, subprocess or FFI authority;
- traversal or symlink escape outside the approved context root;
- `.git`, `.env*` or other denied namespaces becoming readable unexpectedly;
- forging authenticated host/runner frames or crossing execution channels;
- resetting turn budgets through session/message identity confusion;
- child sessions inheriting tools or context they should not receive;
- resource-envelope controls being bypassed in a way not already documented in `docs/known-limitations.md`.

Known limitations that are already documented are still welcome as design discussions, but should not be reported as newly discovered vulnerabilities without a new bypass or impact.
