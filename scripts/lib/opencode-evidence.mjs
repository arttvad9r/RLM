import { spawnSync } from "node:child_process"

export const unwrap = (value) => value?.data ?? value

export function sumUsage(messages) {
  const out = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost_usd: 0 }
  for (const message of messages ?? []) {
    const info = message?.info ?? message
    if (message?.type !== "assistant" && info?.role !== "assistant") continue
    const tokens = info?.tokens ?? message?.tokens ?? {}
    out.input += Number(tokens.input ?? 0)
    out.output += Number(tokens.output ?? 0)
    out.reasoning += Number(tokens.reasoning ?? 0)
    out.cache_read += Number(tokens.cache?.read ?? 0)
    out.cache_write += Number(tokens.cache?.write ?? 0)
    out.cost_usd += Number(info?.cost ?? message?.cost ?? 0)
  }
  return out
}

export function assistantModels(messages) {
  const models = new Set()
  for (const message of messages ?? []) {
    const info = message?.info ?? message
    if (message?.type !== "assistant" && info?.role !== "assistant") continue
    const model = info?.model ?? message?.model
    if (!model) continue
    const provider = model.providerID ?? model.providerId ?? model.provider
    const id = model.modelID ?? model.id ?? model.model
    if (!provider || !id) continue
    models.add(`${provider}/${id}${model.variant ? `#${model.variant}` : ""}`)
  }
  return [...models].sort()
}

function addUsage(target, source) {
  for (const key of Object.keys(target)) target[key] += Number(source[key] ?? 0)
}

export async function captureOpenCodeSessionTree(api, rootSessionID) {
  const sessions = unwrap(await api("/api/session")) ?? []
  const byParent = new Map()
  for (const session of sessions) {
    const parent = session.parentID
    if (!parent) continue
    const children = byParent.get(parent) ?? []
    children.push(session)
    byParent.set(parent, children)
  }

  const queue = [{ id: rootSessionID, parentID: null, depth: 0 }]
  const seen = new Set()
  const records = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || seen.has(current.id)) continue
    seen.add(current.id)
    const messages = unwrap(await api(`/api/session/${current.id}/message`)) ?? []
    records.push({
      session_id: current.id,
      parent_session_id: current.parentID,
      depth: current.depth,
      models: assistantModels(messages),
      usage: sumUsage(messages),
    })
    for (const child of byParent.get(current.id) ?? []) {
      queue.push({ id: child.id, parentID: current.id, depth: current.depth + 1 })
    }
  }

  const root = records.find((record) => record.depth === 0)
  const descendants = records.filter((record) => record.depth > 0)
  const descendantUsage = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost_usd: 0 }
  for (const record of descendants) addUsage(descendantUsage, record.usage)
  const totalUsage = { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0, cost_usd: 0 }
  if (root) addUsage(totalUsage, root.usage)
  addUsage(totalUsage, descendantUsage)

  return {
    schema_version: 1,
    root_session_id: rootSessionID,
    session_count: records.length,
    descendant_count: descendants.length,
    root: root ?? null,
    descendants,
    descendant_usage: descendantUsage,
    total_usage: totalUsage,
  }
}

export function captureCodeBurnSessions(sessionIDs) {
  const wanted = new Set(sessionIDs)
  if (wanted.size === 0) return { available: true, sessions: [], total_cost_usd: 0 }
  const result = spawnSync("codeburn", [
    "sessions", "--period", "all", "--provider", "opencode", "--format", "json", "--no-pager",
  ], { encoding: "utf8", timeout: 30_000 })
  if (result.error?.code === "ENOENT") return { available: false, reason: "codeburn_not_installed", sessions: [] }
  if (result.status !== 0) {
    return {
      available: false,
      reason: "codeburn_failed",
      detail: String(result.stderr || result.stdout || "").slice(0, 1000),
      sessions: [],
    }
  }
  try {
    const parsed = JSON.parse(result.stdout)
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sessions) ? parsed.sessions : []
    const sessions = rows
      .filter((row) => wanted.has(row.sessionId))
      .map((row) => ({
        session_id: row.sessionId,
        models: Array.isArray(row.models) ? row.models : [],
        calls: Number(row.calls ?? 0),
        turns: Number(row.turns ?? 0),
        input_tokens: Number(row.inputTokens ?? 0),
        output_tokens: Number(row.outputTokens ?? 0),
        cache_read_tokens: Number(row.cacheReadTokens ?? 0),
        cache_write_tokens: Number(row.cacheWriteTokens ?? 0),
        api_equivalent_cost_usd: Number(row.cost ?? 0),
      }))
    return {
      available: true,
      matched: sessions.length,
      requested: wanted.size,
      sessions,
      total_cost_usd: sessions.reduce((sum, row) => sum + row.api_equivalent_cost_usd, 0),
    }
  } catch (error) {
    return { available: false, reason: "codeburn_invalid_json", detail: String(error), sessions: [] }
  }
}
