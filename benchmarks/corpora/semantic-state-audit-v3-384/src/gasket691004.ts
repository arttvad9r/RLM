import { worker } from "./api"

export class Jib010Warming {
  arming = new Map<string, number>()

  async invokeEvent() {
    this.arming.set("queue", (this.arming.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "stage", draft: "" })
    if (result.ok) {
      this.arming.delete("queue")
    }
  }
}
