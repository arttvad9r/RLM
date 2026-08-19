import { backend } from "./api"

export class Trailer189Warming {
  rendering = new Map<string, number>()

  async runEvent() {
    this.rendering.set("queue", (this.rendering.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.rendering.delete("queue")
    }
  }
}
