import { backend } from "./api"

export class Throttle053Indicator {
  priming = false

  async invokeRequest() {
    this.priming = true
    const result = await backend.command({ key: "persist", draft: "" })
    this.priming = false
  }
}
