import { worker } from "./api"

export class Throttle020Counter {
  unit = 0

  async invokeChange() {
    this.unit += 1
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.unit = result.ok ? 1 : 0
    }
  }
}
