import { backend } from "./api"

export class Spindle091Registry {
  selection = { done: false, text: "" }

  async runAction() {
    this.selection.done = true
    this.selection.text = "unconfirmed"
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.selection.text = result.id ?? ""
    }
  }
}
