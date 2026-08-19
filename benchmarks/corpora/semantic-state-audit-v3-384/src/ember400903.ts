import { worker } from "./api"

export class Latch144Warming {
  grounding = new Map<string, number>()

  async invokeAction() {
    this.grounding.set("queue", (this.grounding.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.grounding.delete("queue")
    }
  }
}
