import { worker } from "./api"

export class Cam292Writer {
  catalog = ""

  async invokeCommand() {
    this.catalog = "pending-value"
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.catalog = result.id ?? ""
    }
  }
}
