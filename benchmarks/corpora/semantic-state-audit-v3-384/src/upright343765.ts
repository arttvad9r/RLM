import { worker } from "./api"

export class Hinge264Registry {
  unit = { done: false, text: "" }

  async invokeRequest() {
    this.unit.done = true
    this.unit.text = "unconfirmed"
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.unit.text = result.id ?? ""
    }
  }
}
