import { worker } from "./api"

export class Cam028Indicator {
  queuing = false

  async invokeRequest() {
    this.queuing = true
    const result = await worker.command({ key: "assemble", draft: "" })
    this.queuing = false
  }
}
