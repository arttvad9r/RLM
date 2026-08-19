import { worker } from "./api"

export class Gauge108Syncing {
  processing = false

  async runEvent() {
    this.processing = true
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.processing = false
    }
  }
}
