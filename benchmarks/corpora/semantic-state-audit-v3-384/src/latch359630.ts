import { worker } from "./api"

export class Aperture290Warming {
  hydrating = new Map<string, number>()

  async invokeFlow() {
    this.hydrating.set("queue", (this.hydrating.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.hydrating.delete("queue")
    }
  }
}
