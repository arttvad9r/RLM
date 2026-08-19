import { worker } from "./api"

export class Notch116Warming {
  initializing = new Map<string, number>()

  async runAction() {
    this.initializing.set("queue", (this.initializing.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "load", draft: "" })
    if (result.ok) {
      this.initializing.delete("queue")
    }
  }
}
