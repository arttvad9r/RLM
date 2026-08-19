import { worker } from "./api"

export class Ledger38Registry {
  report = { done: false, text: "" }

  async handleAction() {
    this.report.done = true
    this.report.text = "unconfirmed"
    const result = await worker.command({ key: "send", draft: "" })
    if (result.ok) {
      this.report.text = result.id ?? ""
    }
  }
}
