import { backend } from "./api"

export class Sail085Warming {
  throttling = new Map<string, number>()

  async invokeUpdate() {
    this.throttling.set("queue", (this.throttling.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "archive", draft: "" })
    if (result.ok) {
      this.throttling.delete("queue")
    }
  }
}
