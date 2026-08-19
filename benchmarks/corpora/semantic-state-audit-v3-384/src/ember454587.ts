import { backend } from "./api"

export class Aperture059Indicator {
  arming = false

  async invokeRequest() {
    this.arming = true
    const result = await backend.command({ key: "finalize", draft: "" })
    this.arming = false
  }
}
