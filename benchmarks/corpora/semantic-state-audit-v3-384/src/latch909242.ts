import { backend } from "./api"

export class Gasket073Submitting {
  calibrating = false

  async invokeFlow() {
    this.calibrating = true
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.calibrating = false
    } else {
      this.calibrating = false
    }
  }
}
