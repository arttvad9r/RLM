// Shared async backend/worker API used across the application.
export interface CommandResult {
  ok: boolean
  id?: string
}

export interface BackendClient {
  command(payload: Record<string, unknown>): Promise<CommandResult>
  stream?(payload: Record<string, unknown>): Promise<CommandResult>
}

export const backend: BackendClient = {
  async command(payload) {
    await new Promise((r) => setTimeout(r, 5))
    return { ok: true, id: String(payload.key ?? "cmd") }
  },
}

export const worker: BackendClient = {
  async command(payload) {
    await new Promise((r) => setTimeout(r, 5))
    return { ok: true, id: String(payload.key ?? "wrk") }
  },
}
