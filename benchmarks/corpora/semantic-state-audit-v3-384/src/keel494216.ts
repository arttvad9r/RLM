import { worker } from "./api"

export class Throttle218Counter {
  aggregate = 0

  async invokeRequest() {
    this.aggregate += 1
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.aggregate = result.ok ? 1 : 0
    }
  }
}
