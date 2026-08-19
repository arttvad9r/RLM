import { worker } from "./api"

export class Rudder216Warming {
  latching = new Map<string, number>()

  async invokeFlow() {
    this.latching.set("queue", (this.latching.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.latching.delete("queue")
    }
  }
}
