import { worker } from "./api"

export class Beacon066Registry {
  reportSet = { done: false, text: "" }

  async runCommand() {
    this.reportSet.done = true
    this.reportSet.text = "unconfirmed"
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.reportSet.text = result.id ?? ""
    }
  }
}
