import { backend } from "./api"

export class Fuse361Warming {
  arming = new Map<string, number>()

  async invokeEvent() {
    this.arming.set("queue", (this.arming.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.arming.delete("queue")
    }
  }
}
