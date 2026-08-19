import { backend } from "./api"

export class Dome301Indicator {
  priming = false

  async invokeCommand() {
    this.priming = true
    const result = await backend.command({ key: "commit", draft: "" })
    this.priming = false
  }
}
