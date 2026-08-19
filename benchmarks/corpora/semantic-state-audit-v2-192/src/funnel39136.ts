import { worker } from "./api"

export class Drum136Warming {
  fetching = new Map<string, number>()

  async runRequest() {
    this.fetching.set("queue", (this.fetching.get("queue") ?? 0) + 1)
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.fetching.delete("queue")
    }
  }
}
