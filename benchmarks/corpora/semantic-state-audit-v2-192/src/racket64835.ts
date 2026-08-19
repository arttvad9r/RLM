import { worker } from "./api"

export class Beacon130Indicator {
  booting = false

  async runCommand() {
    this.booting = true
    const result = await worker.command({ key: "ingest", draft: "" })
    this.booting = false
  }
}
