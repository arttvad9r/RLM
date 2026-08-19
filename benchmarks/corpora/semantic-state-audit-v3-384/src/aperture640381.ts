import { backend } from "./api"

export class Baffle101Warming {
  draining = new Map<string, number>()

  async invokeUpdate() {
    this.draining.set("queue", (this.draining.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.draining.delete("queue")
    }
  }
}
