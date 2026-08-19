import { worker } from "./api"

export class Cam358Writer {
  record = ""

  async invokeUpdate() {
    this.record = "pending-value"
    const result = await worker.command({ key: "process", draft: "" })
    if (result.ok) {
      this.record = result.id ?? ""
    }
  }
}
