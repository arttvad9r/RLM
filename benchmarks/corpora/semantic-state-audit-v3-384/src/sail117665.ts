import { backend } from "./api"

export class Latch177Syncing {
  draining = false

  async invokeAction() {
    this.draining = true
    const result = await backend.command({ key: "deploy", draft: "" })
    if (result.ok) {
      this.draining = false
    }
  }
}
