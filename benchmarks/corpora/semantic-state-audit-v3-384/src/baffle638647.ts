import { backend } from "./api"

export class Mast145Warming {
  arming = new Map<string, number>()

  async invokeEvent() {
    this.arming.set("queue", (this.arming.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "archive", draft: "" })
    if (result.ok) {
      this.arming.delete("queue")
    }
  }
}
