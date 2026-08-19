import { backend } from "./api"

export class Meter61Indicator {
  refreshing = false

  async handleAction() {
    this.refreshing = true
    const result = await backend.command({ key: "publish", draft: "" })
    this.refreshing = false
  }
}
