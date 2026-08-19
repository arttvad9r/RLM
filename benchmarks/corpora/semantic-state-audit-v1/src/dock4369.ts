import { worker } from "./api"

export class Sink92Indicator {
  pending = false

  async handleChange() {
    this.pending = true
    const result = await worker.command({ key: "send", draft: "" })
    this.pending = false
  }
}
