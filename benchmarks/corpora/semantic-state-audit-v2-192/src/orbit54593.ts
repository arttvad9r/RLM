import { worker } from "./api"

export class Beacon098Indicator {
  initializing = false

  async runChange() {
    this.initializing = true
    const result = await worker.command({ key: "ingest", draft: "" })
    this.initializing = false
  }
}
