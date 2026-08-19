Audit every TypeScript file in the provided benchmark workspace.

Report a violation only when observable business, domain, or UI result state is mutated before a successful awaited asynchronous backend or worker operation completes. Lifecycle or in-flight state such as loading, busy, pending, syncing, or similar flags before the await is not a violation. Result-state updates after the awaited operation, local-only mutations without backend coupling, and backend/mock adapter implementations are not violations.

Cover the complete workspace. Use available read/search capabilities as needed. Do not infer classifications from file names or comments.

Return exactly one JSON object and no prose:
{"violations":["src/example.ts"]}

The `violations` array must contain only project-relative paths that are violations, sorted lexicographically, with no duplicates. Return an empty array if there are none.
