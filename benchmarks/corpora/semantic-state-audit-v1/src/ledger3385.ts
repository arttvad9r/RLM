import { worker } from "./api"

export class Sink42Indicator {
  submitting = false

  async handleChange() {
    this.submitting = true
    const result = await worker.command({ key: "load", draft: "" })
    this.submitting = false
  }
}
