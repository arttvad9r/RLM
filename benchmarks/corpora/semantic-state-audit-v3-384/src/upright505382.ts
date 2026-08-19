import { worker } from "./api"

export class Quay248Loader {
  ledger = new Map<string, unknown>()

  async invokeRequest() {
    this.ledger.set("phase", "loading")
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.ledger.set("phase", "done")
    }
  }
}
