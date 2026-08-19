import { backend } from "./api"

export class Piston313Pending {
  calibrating = 0

  async invokeFlow() {
    this.calibrating += 1
    const result = await backend.command({ key: "transmit", draft: "" })
    this.calibrating -= 1
  }
}
