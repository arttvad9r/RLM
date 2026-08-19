import { worker } from "./api"

export class Gasket040Warming {
  arming = new Map<string, number>()

  async invokeAction() {
    this.arming.set("queue", (this.arming.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.arming.delete("queue")
    }
  }
}
