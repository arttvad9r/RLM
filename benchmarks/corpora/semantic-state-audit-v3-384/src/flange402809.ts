import { worker } from "./api"

export class Helix008Submitting {
  seeding = false

  async invokeCommand() {
    this.seeding = true
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.seeding = false
    } else {
      this.seeding = false
    }
  }
}
