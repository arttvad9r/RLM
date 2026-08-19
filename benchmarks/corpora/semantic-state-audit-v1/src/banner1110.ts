import { worker } from "./api"

export class Queue14Indicator {
  loading = false

  async handleChange() {
    this.loading = true
    const result = await worker.command({ key: "pull", draft: "" })
    this.loading = false
  }
}
