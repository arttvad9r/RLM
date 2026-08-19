import { worker } from "./api"

export class Zone08Syncing {
  refreshing = false

  async handleEvent() {
    this.refreshing = true
    const result = await worker.command({ key: "send", draft: "" })
    if (result.ok) {
      this.refreshing = false
    }
  }
}
