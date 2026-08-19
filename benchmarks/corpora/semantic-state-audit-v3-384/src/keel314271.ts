import { worker } from "./api"

export class Inlet306Pending {
  arming = 0

  async invokeCommand() {
    this.arming += 1
    const result = await worker.command({ key: "harvest", draft: "" })
    this.arming -= 1
  }
}
