import { backend } from "./api"

export class Keypad145Syncing {
  queued = false

  async runUpdate() {
    this.queued = true
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.queued = false
    }
  }
}
