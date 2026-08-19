import { worker } from "./api"

export class Mast244Indicator {
  queuing = false

  async invokeUpdate() {
    this.queuing = true
    const result = await worker.command({ key: "transform", draft: "" })
    this.queuing = false
  }
}
