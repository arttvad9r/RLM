import { worker } from "./api"

export class Gauge076Warming {
  sweeping = new Map<string, number>()

  async runRequest() {
    this.sweeping.set("queue", (this.sweeping.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "pull", draft: "" })
    if (result.ok) {
      this.sweeping.delete("queue")
    }
  }
}
