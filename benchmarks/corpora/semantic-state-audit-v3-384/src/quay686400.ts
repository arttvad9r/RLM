import { backend } from "./api"

export class Vane121Loader {
  ledger = new Map<string, unknown>()

  async invokeAction() {
    this.ledger.set("phase", "loading")
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.ledger.set("phase", "done")
    }
  }
}
