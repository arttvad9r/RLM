import assert from "node:assert/strict"
import test from "node:test"
import { homedir, tmpdir } from "node:os"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { readRlmHostConfig } from "../rlm-lib/host-config.ts"
import { RlmError } from "../rlm-lib/errors.ts"
import { confinePath, resolveWorkspaceRoot } from "../rlm-lib/workspace.ts"

async function withProcessEnv(values, fn) {
  const previous = new Map()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test("host config fails closed on malformed or unexpected authority fields", async () => {
  const config = await mkdtemp(path.join(tmpdir(), "rlm-host-config-"))
  const agents = path.join(config, "rlm")
  await mkdir(agents, { recursive: true })
  const file = path.join(agents, "host.json")
  try {
    await writeFile(file, "not-json")
    await assert.rejects(
      () => readRlmHostConfig({ XDG_CONFIG_HOME: config }),
      (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /malformed JSON/.test(error.message),
    )

    await writeFile(file, JSON.stringify({ version: 1, context_root: "/tmp/project", unexpected: true }))
    await assert.rejects(
      () => readRlmHostConfig({ XDG_CONFIG_HOME: config }),
      (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /unexpected properties/.test(error.message),
    )

    await writeFile(file, JSON.stringify({ version: 1, context_root: "relative/project" }))
    await assert.rejects(
      () => readRlmHostConfig({ XDG_CONFIG_HOME: config }),
      (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /context_root must be an absolute path/.test(error.message),
    )
  } finally {
    await rm(config, { recursive: true, force: true })
  }
})

test("relative XDG config root is rejected instead of selecting authority relative to process cwd", async () => {
  await assert.rejects(
    () => readRlmHostConfig({ XDG_CONFIG_HOME: "relative-config" }),
    (error) => error instanceof RlmError
      && error.code === "CONTEXT_DENIED"
      && /XDG_CONFIG_HOME must be an absolute path/.test(error.message),
  )
})

test("host config root takes precedence over ambient root authority", async () => {
  const config = await mkdtemp(path.join(tmpdir(), "rlm-host-config-precedence-"))
  const approved = await mkdtemp(path.join(tmpdir(), "rlm-approved-root-"))
  const ambient = await mkdtemp(path.join(tmpdir(), "rlm-ambient-root-"))
  const session = await mkdtemp(path.join(tmpdir(), "rlm-session-root-"))
  const agents = path.join(config, "rlm")
  await mkdir(agents, { recursive: true })
  await writeFile(path.join(agents, "host.json"), JSON.stringify({ version: 1, context_root: approved }))
  try {
    await withProcessEnv({
      XDG_CONFIG_HOME: config,
      RLM_CONTEXT_ROOT: ambient,
    }, async () => {
      const resolved = await resolveWorkspaceRoot(session, "/")
      assert.equal(resolved.root, approved)
    })
  } finally {
    await rm(config, { recursive: true, force: true })
    await rm(approved, { recursive: true, force: true })
    await rm(ambient, { recursive: true, force: true })
    await rm(session, { recursive: true, force: true })
  }
})


test("OpenCode legacy host config is used only when the trusted adapter supplies it", async () => {
  const config = await mkdtemp(path.join(tmpdir(), "rlm-opencode-legacy-config-"))
  const approved = await mkdtemp(path.join(tmpdir(), "rlm-opencode-legacy-approved-"))
  const session = await mkdtemp(path.join(tmpdir(), "rlm-opencode-legacy-session-"))
  const legacyDir = path.join(config, "opencode", "agents")
  const legacyFile = path.join(legacyDir, ".rlm-host.json")
  await mkdir(legacyDir, { recursive: true })
  await writeFile(legacyFile, JSON.stringify({ version: 1, context_root: approved }))
  try {
    await withProcessEnv({ XDG_CONFIG_HOME: config, RLM_CONTEXT_ROOT: undefined, OPENCODE_RLM_CONTEXT_ROOT: undefined }, async () => {
      const generic = await resolveWorkspaceRoot(session, "/")
      assert.equal(generic.root, session, "generic/Codex hosts must ignore the OpenCode legacy authority file")

      const opencode = await resolveWorkspaceRoot(session, "/", legacyFile)
      assert.equal(opencode.root, approved, "OpenCode adapter fallback must preserve the documented legacy host config")
    })
  } finally {
    await rm(config, { recursive: true, force: true })
    await rm(approved, { recursive: true, force: true })
    await rm(session, { recursive: true, force: true })
  }
})

test("generic host config takes precedence over an adapter legacy fallback", async () => {
  const config = await mkdtemp(path.join(tmpdir(), "rlm-host-config-vs-legacy-"))
  const genericRoot = await mkdtemp(path.join(tmpdir(), "rlm-generic-approved-"))
  const legacyRoot = await mkdtemp(path.join(tmpdir(), "rlm-legacy-approved-"))
  const session = await mkdtemp(path.join(tmpdir(), "rlm-config-precedence-session-"))
  const genericDir = path.join(config, "rlm")
  const legacyDir = path.join(config, "opencode", "agents")
  const legacyFile = path.join(legacyDir, ".rlm-host.json")
  await mkdir(genericDir, { recursive: true })
  await mkdir(legacyDir, { recursive: true })
  await writeFile(path.join(genericDir, "host.json"), JSON.stringify({ version: 1, context_root: genericRoot }))
  await writeFile(legacyFile, JSON.stringify({ version: 1, context_root: legacyRoot }))
  try {
    await withProcessEnv({ XDG_CONFIG_HOME: config }, async () => {
      const resolved = await resolveWorkspaceRoot(session, "/", legacyFile)
      assert.equal(resolved.root, genericRoot)
    })
  } finally {
    await rm(config, { recursive: true, force: true })
    await rm(genericRoot, { recursive: true, force: true })
    await rm(legacyRoot, { recursive: true, force: true })
    await rm(session, { recursive: true, force: true })
  }
})

test("relative environment context root is rejected instead of depending on process cwd", async () => {
  const session = await mkdtemp(path.join(tmpdir(), "rlm-relative-env-session-"))
  try {
    await withProcessEnv({ XDG_CONFIG_HOME: undefined, RLM_CONTEXT_ROOT: "." }, async () => {
      await assert.rejects(
        () => resolveWorkspaceRoot(session, "/"),
        (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /explicit context root must be an absolute path/.test(error.message),
      )
    })
  } finally {
    await rm(session, { recursive: true, force: true })
  }
})

test("fallback worktree must contain the session directory", async () => {
  const worktree = await mkdtemp(path.join(tmpdir(), "rlm-worktree-"))
  const outside = await mkdtemp(path.join(tmpdir(), "rlm-outside-session-"))
  try {
    await withProcessEnv({ XDG_CONFIG_HOME: undefined, RLM_CONTEXT_ROOT: undefined }, async () => {
      await assert.rejects(
        () => resolveWorkspaceRoot(outside, worktree),
        (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /outside host worktree/.test(error.message),
      )
    })
  } finally {
    await rm(worktree, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test("filesystem root and exact user HOME are rejected as context roots", async () => {
  const session = await mkdtemp(path.join(tmpdir(), "rlm-session-safe-"))
  try {
    await withProcessEnv({ XDG_CONFIG_HOME: undefined, RLM_CONTEXT_ROOT: path.parse(session).root }, async () => {
      await assert.rejects(
        () => resolveWorkspaceRoot(session, "/"),
        (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /filesystem root/.test(error.message),
      )
    })
    await withProcessEnv({ XDG_CONFIG_HOME: undefined, RLM_CONTEXT_ROOT: homedir() }, async () => {
      await assert.rejects(
        () => resolveWorkspaceRoot(session, "/"),
        (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /user HOME/.test(error.message),
      )
    })
  } finally {
    await rm(session, { recursive: true, force: true })
  }
})

test("missing targets under an escaping symlink are denied before file operations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "rlm-confine-root-"))
  const outside = await mkdtemp(path.join(tmpdir(), "rlm-confine-outside-"))
  try {
    await symlink(outside, path.join(root, "escape"), "dir")
    await assert.rejects(
      () => confinePath(root, "escape/missing/deeper.txt"),
      (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /via symlink/.test(error.message),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})


test("host config accepts child-model-only policy without forcing a context root", async () => {
  const config = await mkdtemp(path.join(tmpdir(), "rlm-child-policy-"))
  const dir = path.join(config, "rlm")
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(path.join(dir, "host.json"), JSON.stringify({ version: 1, child_model: { strategy: "fixed", provider: "openai", model: "gpt-6-luna", variant: "low" } }))
    const parsed = await readRlmHostConfig({ XDG_CONFIG_HOME: config })
    assert.deepEqual(parsed, { version: 1, context_policy: undefined, child_model: { strategy: "fixed", provider: "openai", model: "gpt-6-luna", variant: "low" } })
  } finally { await rm(config, { recursive: true, force: true }) }
})


test("host config falls back to $HOME/.config when XDG_CONFIG_HOME is unset", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "rlm-default-config-home-"))
  const dir = path.join(home, ".config", "rlm")
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(path.join(dir, "host.json"), JSON.stringify({ version: 1, child_model: { strategy: "fixed", provider: "openai", model: "gpt-6-luna", variant: "low" } }))
    const parsed = await readRlmHostConfig({ HOME: home, XDG_CONFIG_HOME: undefined })
    assert.equal(parsed?.child_model?.strategy, "fixed")
    assert.equal(parsed?.child_model?.model, "gpt-6-luna")
  } finally { await rm(home, { recursive: true, force: true }) }
})
