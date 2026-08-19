import { RlmError } from "../rlm-lib/errors.ts"
import { confinePath, resolveWorkspaceRoot } from "../rlm-lib/workspace.ts"

const ROOT_ENV = "OPENCODE_RLM_CONTEXT_ROOT"
const CONFIG_ENV = "XDG_CONFIG_HOME"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function assertRejectsCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn()
  } catch (error) {
    assert(error instanceof RlmError, `expected RlmError, got ${String(error)}`)
    assert(error.code === code, `expected ${code}, got ${error.code}`)
    return
  }
  throw new Error(`expected ${code}`)
}

Deno.test("workspace root distinguishes trusted host authority from fallback OpenCode roots", async () => {
  const previousRoot = Deno.env.get(ROOT_ENV)
  const previousConfig = Deno.env.get(CONFIG_ENV)
  const root = await Deno.makeTempDir({ prefix: "rlm-root-" })
  const outsideSession = await Deno.makeTempDir({ prefix: "rlm-session-" })
  const config = await Deno.makeTempDir({ prefix: "rlm-config-" })
  const child = `${root}/child`
  await Deno.mkdir(child)

  try {
    Deno.env.delete(ROOT_ENV)
    Deno.env.delete(CONFIG_ENV)
    await assertRejectsCode(() => resolveWorkspaceRoot("/", "/"), "CONTEXT_DENIED")

    const home = Deno.env.get("HOME")
    if (home) await assertRejectsCode(() => resolveWorkspaceRoot(home, "/"), "CONTEXT_DENIED")

    const inferred = await resolveWorkspaceRoot(child, root)
    assert(inferred.root === await Deno.realPath(root), "git worktree must be the inferred context root")
    await assertRejectsCode(() => resolveWorkspaceRoot(outsideSession, root), "CONTEXT_DENIED")

    // Explicit environment authority is independent from the session directory
    // and remains confined by confinePath(root, ...).
    Deno.env.set(ROOT_ENV, root)
    const explicit = await resolveWorkspaceRoot(outsideSession, "/")
    assert(explicit.root === await Deno.realPath(root), "explicit approved root must be authoritative")
    assert(explicit.broad === false && explicit.unsafe === false, "approved project root must not be broad/unsafe")
    await assertRejectsCode(() => confinePath(root, "../escape"), "CONTEXT_DENIED")

    Deno.env.set(ROOT_ENV, `${root}/missing`)
    await assertRejectsCode(() => resolveWorkspaceRoot(outsideSession, "/"), "CONTEXT_DENIED")

    // Host-config authority has the same root semantics as explicit environment
    // authority: the approved context root may differ from the session root.
    Deno.env.delete(ROOT_ENV)
    const agents = `${config}/opencode/agents`
    await Deno.mkdir(agents, { recursive: true })
    await Deno.writeTextFile(`${agents}/.rlm-host.json`, JSON.stringify({
      version: 1,
      context_root: root,
      context_policy: { allowed_paths: ["child"] },
    }))
    Deno.env.set(CONFIG_ENV, config)
    const hostConfigured = await resolveWorkspaceRoot(outsideSession, "/")
    assert(hostConfigured.root === await Deno.realPath(root), "host config must own context root")
  } finally {
    if (previousRoot === undefined) Deno.env.delete(ROOT_ENV)
    else Deno.env.set(ROOT_ENV, previousRoot)
    if (previousConfig === undefined) Deno.env.delete(CONFIG_ENV)
    else Deno.env.set(CONFIG_ENV, previousConfig)
    await Deno.remove(root, { recursive: true })
    await Deno.remove(outsideSession, { recursive: true })
    await Deno.remove(config, { recursive: true })
  }
})

Deno.test("missing targets below an escaping symlink are denied", async () => {
  const root = await Deno.makeTempDir({ prefix: "rlm-symlink-root-" })
  const outside = await Deno.makeTempDir({ prefix: "rlm-symlink-outside-" })
  try {
    await Deno.symlink(outside, `${root}/escape`, { type: "dir" })
    await assertRejectsCode(() => confinePath(root, "escape/missing/deeper.txt"), "CONTEXT_DENIED")
  } finally {
    await Deno.remove(root, { recursive: true })
    await Deno.remove(outside, { recursive: true })
  }
})
