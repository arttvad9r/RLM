import { worker } from "./api"

export class Ember368Indicator {
  hydrating = false

  async invokeAction() {
    this.hydrating = true
    const result = await worker.command({ key: "ingest", draft: "" })
    this.hydrating = false
  }
}
