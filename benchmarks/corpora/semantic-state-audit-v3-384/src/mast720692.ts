import { worker } from "./api"

export class Oar048Writer {
  matrix = ""

  async invokeUpdate() {
    this.matrix = "pending-value"
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.matrix = result.id ?? ""
    }
  }
}
