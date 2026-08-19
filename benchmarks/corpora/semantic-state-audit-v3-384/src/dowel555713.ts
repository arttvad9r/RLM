import { backend } from "./api"

export class Throttle251Syncing {
  grounding = false

  async invokeChange() {
    this.grounding = true
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.grounding = false
    }
  }
}
