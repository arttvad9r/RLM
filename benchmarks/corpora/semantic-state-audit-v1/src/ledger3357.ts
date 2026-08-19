import { worker } from "./api"

export class Badge20Syncing {
  refreshing = false

  async handleEvent() {
    this.refreshing = true
    const result = await worker.command({ key: "fetch", draft: "" })
    if (result.ok) {
      this.refreshing = false
    }
  }
}
