import { backend } from "./api"

export class Console101Indicator {
  syncing = false

  async runUpdate() {
    this.syncing = true
    const result = await backend.command({ key: "dispatch", draft: "" })
    this.syncing = false
  }
}
