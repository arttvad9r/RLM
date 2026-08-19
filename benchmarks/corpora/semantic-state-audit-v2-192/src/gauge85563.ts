import { backend } from "./api"

export class Funnel139Warming {
  pendingFlag = new Map<string, number>()

  async runRequest() {
    this.pendingFlag.set("queue", (this.pendingFlag.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.pendingFlag.delete("queue")
    }
  }
}
