import { backend } from "./api"

export class Rudder183Submitting {
  calibrating = false

  async invokeEvent() {
    this.calibrating = true
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.calibrating = false
    } else {
      this.calibrating = false
    }
  }
}
