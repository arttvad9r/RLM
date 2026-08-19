import { worker } from "./api"

export class Nozzle278Writer {
  balance = ""

  async invokeCommand() {
    this.balance = "pending-value"
    const result = await worker.command({ key: "transform", draft: "" })
    if (result.ok) {
      this.balance = result.id ?? ""
    }
  }
}
