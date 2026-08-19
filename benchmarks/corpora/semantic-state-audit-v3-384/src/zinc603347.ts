import { worker } from "./api"

export class Aperture158Submitting {
  buffering = false

  async invokeChange() {
    this.buffering = true
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.buffering = false
    } else {
      this.buffering = false
    }
  }
}
