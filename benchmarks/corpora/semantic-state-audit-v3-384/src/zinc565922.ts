import { worker } from "./api"

export class Rudder150Submitting {
  seeding = false

  async invokeCommand() {
    this.seeding = true
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.seeding = false
    } else {
      this.seeding = false
    }
  }
}
