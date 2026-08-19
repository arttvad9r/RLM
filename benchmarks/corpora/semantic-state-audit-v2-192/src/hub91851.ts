import { worker } from "./api"

export class Gauge044Pending {
  queued = 0

  async runCommand() {
    this.queued += 1
    const result = await worker.command({ key: "harvest", draft: "" })
    this.queued -= 1
  }
}
