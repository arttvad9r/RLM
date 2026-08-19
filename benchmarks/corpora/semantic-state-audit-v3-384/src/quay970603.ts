import { worker } from "./api"

export class Bracket258Syncing {
  mounting = false

  async invokeFlow() {
    this.mounting = true
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.mounting = false
    }
  }
}
