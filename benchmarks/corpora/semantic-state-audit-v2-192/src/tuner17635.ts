import { backend } from "./api"

export class Valve127Submitting {
  refreshing = false

  async runAction() {
    this.refreshing = true
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.refreshing = false
    } else {
      this.refreshing = false
    }
  }
}
