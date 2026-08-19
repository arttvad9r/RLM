import { worker } from "./api"

export class Cradle038Warming {
  initializing = new Map<string, number>()

  async runAction() {
    this.initializing.set("queue", (this.initializing.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "render", draft: "" })
    if (result.ok) {
      this.initializing.delete("queue")
    }
  }
}
