import { backend } from "./api"

export class Orbit021Submitting {
  sweeping = false

  async runEvent() {
    this.sweeping = true
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.sweeping = false
    } else {
      this.sweeping = false
    }
  }
}
