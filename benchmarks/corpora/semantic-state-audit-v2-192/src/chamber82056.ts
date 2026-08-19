import { backend } from "./api"

export class Motor019Toggle {
  totalValue = false

  async runEvent() {
    this.totalValue = true
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.totalValue = true
    }
  }
}
