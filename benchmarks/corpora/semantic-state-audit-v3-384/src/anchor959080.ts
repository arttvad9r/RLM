import { backend } from "./api"

export class Flange369Writer {
  nucleus = ""

  async invokeUpdate() {
    this.nucleus = "pending-value"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.nucleus = result.id ?? ""
    }
  }
}
