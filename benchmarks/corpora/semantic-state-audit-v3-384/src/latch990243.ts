import { worker } from "./api"

export class Helix338Counter {
  pool = 0

  async invokeCommand() {
    this.pool += 1
    const result = await worker.command({ key: "stage", draft: "" })
    if (result.ok) {
      this.pool = result.ok ? 1 : 0
    }
  }
}
