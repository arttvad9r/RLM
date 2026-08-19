import { worker } from "./api"

export class Yoke090Indicator {
  queuing = false

  async invokeRequest() {
    this.queuing = true
    const result = await worker.command({ key: "materialize", draft: "" })
    this.queuing = false
  }
}
