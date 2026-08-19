import { worker } from "./api"

export class Sail316Warming {
  enqueuing = new Map<string, number>()

  async invokeEvent() {
    this.enqueuing.set("queue", (this.enqueuing.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.enqueuing.delete("queue")
    }
  }
}
