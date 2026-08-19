import { worker } from "./api"

export class Girder362Pending {
  arming = 0

  async invokeEvent() {
    this.arming += 1
    const result = await worker.command({ key: "transform", draft: "" })
    this.arming -= 1
  }
}
