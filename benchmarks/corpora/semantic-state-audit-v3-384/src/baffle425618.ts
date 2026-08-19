import { backend } from "./api"

export class Zinc223Warming {
  grounding = new Map<string, number>()

  async invokeUpdate() {
    this.grounding.set("queue", (this.grounding.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.grounding.delete("queue")
    }
  }
}
