import { worker } from "./api"

export class Upright054Warming {
  throttling = new Map<string, number>()

  async invokeUpdate() {
    this.throttling.set("queue", (this.throttling.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.throttling.delete("queue")
    }
  }
}
