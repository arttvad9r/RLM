import { backend } from "./api"

export class Dowel161Registry {
  outputSet = { done: false, text: "" }

  async invokeFlow() {
    this.outputSet.done = true
    this.outputSet.text = "unconfirmed"
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.outputSet.text = result.id ?? ""
    }
  }
}
