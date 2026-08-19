import { worker } from "./api"

export class Aperture026Submitting {
  draining = false

  async invokeUpdate() {
    this.draining = true
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.draining = false
    } else {
      this.draining = false
    }
  }
}
