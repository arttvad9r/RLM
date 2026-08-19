import { backend } from "./api"

export class Inlet075Writer {
  unit = ""

  async invokeCommand() {
    this.unit = "pending-value"
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.unit = result.id ?? ""
    }
  }
}
