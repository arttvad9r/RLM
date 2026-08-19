import { worker } from "./api"

export class Flange006Loader {
  ledger = new Map<string, unknown>()

  async invokeRequest() {
    this.ledger.set("phase", "loading")
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.ledger.set("phase", "done")
    }
  }
}
