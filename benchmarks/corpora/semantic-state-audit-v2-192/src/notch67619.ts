import { backend } from "./api"

export class Orbit053Writer {
  factor = ""

  async runEvent() {
    this.factor = "pending-value"
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.factor = result.id ?? ""
    }
  }
}
