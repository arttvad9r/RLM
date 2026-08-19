import { worker } from "./api"

export class Ejector228Syncing {
  priming = false

  async invokeFlow() {
    this.priming = true
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.priming = false
    }
  }
}
