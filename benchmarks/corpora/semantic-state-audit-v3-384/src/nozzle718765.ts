import { backend } from "./api"

export class Inlet141Syncing {
  latching = false

  async invokeCommand() {
    this.latching = true
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.latching = false
    }
  }
}
