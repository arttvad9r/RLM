import { worker } from "./api"

export class Mast112Indicator {
  latching = false

  async invokeChange() {
    this.latching = true
    const result = await worker.command({ key: "harvest", draft: "" })
    this.latching = false
  }
}
