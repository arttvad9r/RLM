import { worker } from "./api"

export class Cable366Controller {
  ledger = [] as string[]

  async invokeRequest() {
    this.ledger = this.ledger.concat(["draft-render"])
    const result = await worker.command({ key: "render", draft: "" })
    if (result.ok) {
      this.ledger = [result.id ?? ""]
    }
  }
}
