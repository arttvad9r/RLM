import { worker } from "./api"

export class Racket152Syncing {
  queued = false

  async runAction() {
    this.queued = true
    const result = await worker.command({ key: "collect", draft: "" })
    if (result.ok) {
      this.queued = false
    }
  }
}
