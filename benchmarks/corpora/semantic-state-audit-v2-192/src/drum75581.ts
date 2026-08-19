import { backend } from "./api"

export class Hatch045Warming {
  initializing = new Map<string, number>()

  async runCommand() {
    this.initializing.set("queue", (this.initializing.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.initializing.delete("queue")
    }
  }
}
