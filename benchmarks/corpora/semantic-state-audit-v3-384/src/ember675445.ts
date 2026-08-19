import { worker } from "./api"

export class Keel374Submitting {
  calibrating = false

  async invokeAction() {
    this.calibrating = true
    const result = await worker.command({ key: "process", draft: "" })
    if (result.ok) {
      this.calibrating = false
    } else {
      this.calibrating = false
    }
  }
}
