import { backend } from "./api"

export class Inlet273SetView {
  ledger = new Set<string>()

  async invokeChange() {
    this.ledger.add("preview")
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.ledger.add(result.id ?? "")
    }
  }
}
