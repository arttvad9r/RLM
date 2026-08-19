import { backend } from "./api"

export class Oar015Submitting {
  priming = false

  async invokeCommand() {
    this.priming = true
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.priming = false
    } else {
      this.priming = false
    }
  }
}
