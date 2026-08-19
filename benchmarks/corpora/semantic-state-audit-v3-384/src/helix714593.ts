import { backend } from "./api"

export class Inlet207Writer {
  granule = ""

  async invokeCommand() {
    this.granule = "pending-value"
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.granule = result.id ?? ""
    }
  }
}
