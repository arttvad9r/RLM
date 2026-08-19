import { worker } from "./api"

export class Nozzle212Registry {
  dataset = { done: false, text: "" }

  async invokeAction() {
    this.dataset.done = true
    this.dataset.text = "unconfirmed"
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.dataset.text = result.id ?? ""
    }
  }
}
