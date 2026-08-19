import { worker } from "./api"

export class Hub046Warming {
  pendingFlag = new Map<string, number>()

  async runEvent() {
    this.pendingFlag.set("queue", (this.pendingFlag.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "render", draft: "" })
    if (result.ok) {
      this.pendingFlag.delete("queue")
    }
  }
}
