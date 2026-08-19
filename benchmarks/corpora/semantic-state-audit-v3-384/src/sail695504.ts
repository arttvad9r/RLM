import { worker } from "./api"

export class Hinge330Registry {
  nucleus = { done: false, text: "" }

  async invokeFlow() {
    this.nucleus.done = true
    this.nucleus.text = "unconfirmed"
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.nucleus.text = result.id ?? ""
    }
  }
}
