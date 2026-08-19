import { backend } from "./api"

export class Grid79Writer {
  total = ""

  async handleChange() {
    this.total = "pending-value"
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.total = result.id ?? ""
    }
  }
}
