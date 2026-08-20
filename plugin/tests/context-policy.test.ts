import {
  assertRlmContextPathAllowed,
  isRlmContextPathAllowed,
  mayTraverseRlmContextPath,
  resolveActiveRlmContextPolicy,
  resolveRlmContextPolicy,
} from "../rlm-lib/context-policy.ts"
import { RlmError } from "../rlm-lib/errors.ts"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function expectContextDenied(fn: () => unknown): void {
  try {
    fn()
  } catch (error) {
    assert(error instanceof RlmError, `expected RlmError, got ${String(error)}`)
    assert(error.code === "CONTEXT_DENIED", `expected CONTEXT_DENIED, got ${error.code}`)
    return
  }
  throw new Error("expected CONTEXT_DENIED")
}

Deno.test("context policy can only narrow hard limits", () => {
  const policy = resolveRlmContextPolicy({
    OPENCODE_RLM_CONTEXT_POLICY: JSON.stringify({
      allowed_paths: ["src/core", "docs"],
      max_read_bytes: 999_999_999,
      max_grep_matches: 7,
      max_list_entries: 19,
    }),
  })
  assert(policy.allowedPaths.join(",") === "src/core,docs", "expected canonical allowed paths")
  assert(policy.maxReadBytes === 128 * 1024, "host policy must not widen hard read limit")
  assert(policy.maxGrepMatches === 7, "expected narrower grep limit")
  assert(policy.maxListEntries === 19, "expected narrower list limit")
})

Deno.test("context policy supports bounded tree scopes", () => {
  const policy = resolveRlmContextPolicy({
    OPENCODE_RLM_CONTEXT_POLICY: JSON.stringify({ allowed_paths: ["src/core/deep"] }),
  })
  assert(mayTraverseRlmContextPath("src", policy), "ancestor must be traversable")
  assert(mayTraverseRlmContextPath("src/core", policy), "nested ancestor must be traversable")
  assert(isRlmContextPathAllowed("src/core/deep/file.ts", policy), "descendant must be readable")
  assert(!isRlmContextPathAllowed("src/core/other.ts", policy), "sibling must remain denied")
  expectContextDenied(() => assertRlmContextPathAllowed("test/file.ts", policy))
})

Deno.test("context policy always hides generic VCS and secret paths", () => {
  const policy = resolveRlmContextPolicy({ OPENCODE_RLM_CONTEXT_POLICY: JSON.stringify({ allowed_paths: [] }) })
  for (const candidate of [
    ".git/config",
    "src/.git/objects/x",
    ".env",
    "apps/api/.env.production",
    "apps/api/.env.production/secret",
    "src/.env/local",
  ]) {
    assert(!isRlmContextPathAllowed(candidate, policy), `${candidate} must be hidden`)
  }
  assert(isRlmContextPathAllowed(".env.example", policy), ".env.example remains visible")
  assert(!isRlmContextPathAllowed("fixtures/.env.example/value", policy), "nested .env.example fixture must remain hidden")
  assert(isRlmContextPathAllowed(".downstream-state/state.json", policy), "downstream state namespaces require explicit host scoping")
})

Deno.test("context policy rejects malformed authority input", () => {
  for (const raw of [
    "not-json",
    JSON.stringify({ allowed_paths: ["../escape"] }),
    JSON.stringify({ allowed_paths: ["src\\windows"] }),
    JSON.stringify({ max_read_bytes: 0 }),
    JSON.stringify({ extra_authority: true }),
  ]) {
    expectContextDenied(() => resolveRlmContextPolicy({ OPENCODE_RLM_CONTEXT_POLICY: raw }))
  }
})

Deno.test("active context policy loads host config", async () => {
  const root = await Deno.makeTempDir({ prefix: "rlm-host-policy-" })
  try {
    const agents = `${root}/opencode/agents`
    await Deno.mkdir(agents, { recursive: true })
    await Deno.writeTextFile(`${agents}/.rlm-host.json`, JSON.stringify({
      version: 1,
      context_root: "/tmp/approved-repository",
      context_policy: {
        allowed_paths: ["src/core"],
        max_read_bytes: 2048,
        max_grep_matches: 11,
        max_list_entries: 23,
      },
    }))
    const policy = await resolveActiveRlmContextPolicy({ XDG_CONFIG_HOME: root })
    assert(policy.allowedPaths.join(",") === "src/core", "expected configured allowed path")
    assert(policy.maxReadBytes === 2048, "expected configured read limit")
    assert(policy.maxGrepMatches === 11, "expected configured grep limit")
    assert(policy.maxListEntries === 23, "expected configured list limit")
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

Deno.test("host policy cannot be overridden by ambient policy env", async () => {
  const root = await Deno.makeTempDir({ prefix: "rlm-host-policy-env-" })
  try {
    const agents = `${root}/opencode/agents`
    await Deno.mkdir(agents, { recursive: true })
    await Deno.writeTextFile(`${agents}/.rlm-host.json`, JSON.stringify({
      version: 1,
      context_root: "/tmp/approved-repository",
      context_policy: { allowed_paths: ["host-approved"] },
    }))
    const policy = await resolveActiveRlmContextPolicy({
      XDG_CONFIG_HOME: root,
      OPENCODE_RLM_CONTEXT_POLICY: JSON.stringify({ allowed_paths: ["ambient-wider-scope"] }),
    })
    assert(policy.allowedPaths.join(",") === "host-approved", "host authority must win")
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})
