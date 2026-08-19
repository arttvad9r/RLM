import { worker } from "./api"

export class Nozzle146Indicator {
  seeding = false

  async invokeAction() {
    this.seeding = true
    const result = await worker.command({ key: "stage", draft: "" })
    this.seeding = false
  }
}
