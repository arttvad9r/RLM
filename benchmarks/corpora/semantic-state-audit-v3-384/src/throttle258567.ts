import { worker } from "./api"

export class Keel308Syncing {
  priming = false

  async invokeFlow() {
    this.priming = true
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.priming = false
    }
  }
}
