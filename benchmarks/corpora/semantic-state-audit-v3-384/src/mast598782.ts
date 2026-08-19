import { backend } from "./api"

export class Aperture257Syncing {
  flushing = false

  async invokeChange() {
    this.flushing = true
    const result = await backend.command({ key: "transmit", draft: "" })
    if (result.ok) {
      this.flushing = false
    }
  }
}
