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
  const agents = path.join(config, "opencode", "agents")
  await mkdir(agents, { recursive: true })
  const file = path.join(agents, ".rlm-host.json")
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
  const agents = path.join(config, "opencode", "agents")
  await mkdir(agents, { recursive: true })
  await writeFile(path.join(agents, ".rlm-host.json"), JSON.stringify({ version: 1, context_root: approved }))
  try {
    await withProcessEnv({
      XDG_CONFIG_HOME: config,
      OPENCODE_RLM_CONTEXT_ROOT: ambient,
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

test("relative environment context root is rejected instead of depending on process cwd", async () => {
  const session = await mkdtemp(path.join(tmpdir(), "rlm-relative-env-session-"))
  try {
    await withProcessEnv({ XDG_CONFIG_HOME: undefined, OPENCODE_RLM_CONTEXT_ROOT: "." }, async () => {
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
    await withProcessEnv({ XDG_CONFIG_HOME: undefined, OPENCODE_RLM_CONTEXT_ROOT: undefined }, async () => {
      await assert.rejects(
        () => resolveWorkspaceRoot(outside, worktree),
        (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /outside OpenCode worktree/.test(error.message),
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
    await withProcessEnv({ XDG_CONFIG_HOME: undefined, OPENCODE_RLM_CONTEXT_ROOT: path.parse(session).root }, async () => {
      await assert.rejects(
        () => resolveWorkspaceRoot(session, "/"),
        (error) => error instanceof RlmError && error.code === "CONTEXT_DENIED" && /filesystem root/.test(error.message),
      )
    })
    await withProcessEnv({ XDG_CONFIG_HOME: undefined, OPENCODE_RLM_CONTEXT_ROOT: homedir() }, async () => {
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
