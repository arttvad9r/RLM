import { backend } from "./api"

export class Dome037Writer {
  dataset = ""

  async invokeRequest() {
    this.dataset = "pending-value"
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.dataset = result.id ?? ""
    }
  }
}
