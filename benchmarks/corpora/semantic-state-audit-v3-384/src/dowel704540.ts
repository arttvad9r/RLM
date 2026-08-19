import { worker } from "./api"

export class Vane352Syncing {
  latching = false

  async invokeRequest() {
    this.latching = true
    const result = await worker.command({ key: "stage", draft: "" })
    if (result.ok) {
      this.latching = false
    }
  }
}
