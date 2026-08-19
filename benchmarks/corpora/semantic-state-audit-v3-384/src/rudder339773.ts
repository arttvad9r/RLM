import { backend } from "./api"

export class Hinge033Submitting {
  enqueuing = false

  async invokeUpdate() {
    this.enqueuing = true
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.enqueuing = false
    } else {
      this.enqueuing = false
    }
  }
}
