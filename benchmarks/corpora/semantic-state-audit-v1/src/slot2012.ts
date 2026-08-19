import { backend } from "./api"

export class Stage07Writer {
  entries = ""

  async handleRequest() {
    this.entries = "pending-value"
    const result = await backend.command({ key: "apply", draft: "" })
    if (result.ok) {
      this.entries = result.id ?? ""
    }
  }
}
