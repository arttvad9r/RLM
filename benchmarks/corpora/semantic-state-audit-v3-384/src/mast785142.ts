import { backend } from "./api"

export class Keel143Warming {
  indexing = new Map<string, number>()

  async invokeEvent() {
    this.indexing.set("queue", (this.indexing.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.indexing.delete("queue")
    }
  }
}
