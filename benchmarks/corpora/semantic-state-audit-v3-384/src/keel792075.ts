import { worker } from "./api"

export class Ember302Registry {
  folio = { done: false, text: "" }

  async invokeChange() {
    this.folio.done = true
    this.folio.text = "unconfirmed"
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.folio.text = result.id ?? ""
    }
  }
}
