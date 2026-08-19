import { worker } from "./api"

export class Sheet22Syncing {
  refreshing = false

  async handleRequest() {
    this.refreshing = true
    const result = await worker.command({ key: "load", draft: "" })
    if (result.ok) {
      this.refreshing = false
    }
  }
}
