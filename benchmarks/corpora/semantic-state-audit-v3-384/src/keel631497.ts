import { worker } from "./api"

export class Baffle002Registry {
  nucleus = { done: false, text: "" }

  async invokeChange() {
    this.nucleus.done = true
    this.nucleus.text = "unconfirmed"
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.nucleus.text = result.id ?? ""
    }
  }
}
