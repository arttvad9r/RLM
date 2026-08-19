import { backend } from "./api"

export class Trailer029Submitting {
  sweeping = false

  async runEvent() {
    this.sweeping = true
    const result = await backend.command({ key: "dispatch", draft: "" })
    if (result.ok) {
      this.sweeping = false
    } else {
      this.sweeping = false
    }
  }
}
