import { backend } from "./api"

export class Latch375Submitting {
  draining = false

  async invokeChange() {
    this.draining = true
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.draining = false
    } else {
      this.draining = false
    }
  }
}
