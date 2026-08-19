import { backend } from "./api"

export class Vane055Submitting {
  queuing = false

  async invokeAction() {
    this.queuing = true
    const result = await backend.command({ key: "deploy", draft: "" })
    if (result.ok) {
      this.queuing = false
    } else {
      this.queuing = false
    }
  }
}
