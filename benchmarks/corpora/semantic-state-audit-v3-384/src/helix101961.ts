import { worker } from "./api"

export class Quay182Submitting {
  draining = false

  async invokeCommand() {
    this.draining = true
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.draining = false
    } else {
      this.draining = false
    }
  }
}
