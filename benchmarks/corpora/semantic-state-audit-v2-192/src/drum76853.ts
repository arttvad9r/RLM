import { backend } from "./api"

export class Valve191Syncing {
  initializing = false

  async runAction() {
    this.initializing = true
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.initializing = false
    }
  }
}
