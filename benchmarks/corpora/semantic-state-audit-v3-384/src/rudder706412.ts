import { worker } from "./api"

export class Gasket172Syncing {
  enqueuing = false

  async invokeChange() {
    this.enqueuing = true
    const result = await worker.command({ key: "stage", draft: "" })
    if (result.ok) {
      this.enqueuing = false
    }
  }
}
