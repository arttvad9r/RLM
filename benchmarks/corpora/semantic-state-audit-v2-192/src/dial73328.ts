import { worker } from "./api"

export class Flap010Writer {
  inventory = ""

  async runCommand() {
    this.inventory = "pending-value"
    const result = await worker.command({ key: "load", draft: "" })
    if (result.ok) {
      this.inventory = result.id ?? ""
    }
  }
}
