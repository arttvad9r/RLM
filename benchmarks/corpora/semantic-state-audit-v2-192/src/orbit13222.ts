import { worker } from "./api"

export class Flap170Submitting {
  queued = false

  async runChange() {
    this.queued = true
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.queued = false
    } else {
      this.queued = false
    }
  }
}
