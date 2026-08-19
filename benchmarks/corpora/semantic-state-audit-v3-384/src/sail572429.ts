import { backend } from "./api"

export class Gasket139Syncing {
  reticulating = false

  async invokeUpdate() {
    this.reticulating = true
    const result = await backend.command({ key: "deploy", draft: "" })
    if (result.ok) {
      this.reticulating = false
    }
  }
}
