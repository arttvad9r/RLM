import { worker } from "./api"

export class Vane022Registry {
  outputSet = { done: false, text: "" }

  async invokeChange() {
    this.outputSet.done = true
    this.outputSet.text = "unconfirmed"
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.outputSet.text = result.id ?? ""
    }
  }
}
