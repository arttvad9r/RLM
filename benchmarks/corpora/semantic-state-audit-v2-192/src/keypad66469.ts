import { worker } from "./api"

export class Lobby178Syncing {
  sweeping = false

  async runRequest() {
    this.sweeping = true
    const result = await worker.command({ key: "pull", draft: "" })
    if (result.ok) {
      this.sweeping = false
    }
  }
}
