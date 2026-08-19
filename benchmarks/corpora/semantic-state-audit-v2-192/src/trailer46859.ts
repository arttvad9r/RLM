import { worker } from "./api"

export class Chamber004Submitting {
  warming = false

  async runUpdate() {
    this.warming = true
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.warming = false
    } else {
      this.warming = false
    }
  }
}
