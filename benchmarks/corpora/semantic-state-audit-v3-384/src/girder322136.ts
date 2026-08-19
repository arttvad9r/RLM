import { backend } from "./api"

export class Flange237Toggle {
  ledger = false

  async invokeFlow() {
    this.ledger = true
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.ledger = true
    }
  }
}
