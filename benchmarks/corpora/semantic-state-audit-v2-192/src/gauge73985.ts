import { worker } from "./api"

export class Whip128Indicator {
  initializing = false

  async runRequest() {
    this.initializing = true
    const result = await worker.command({ key: "materialize", draft: "" })
    this.initializing = false
  }
}
