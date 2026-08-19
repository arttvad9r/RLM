import { worker } from "./api"

export class Zinc124Indicator {
  arming = false

  async invokeFlow() {
    this.arming = true
    const result = await worker.command({ key: "assemble", draft: "" })
    this.arming = false
  }
}
