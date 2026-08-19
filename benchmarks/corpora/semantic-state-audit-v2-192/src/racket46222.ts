import { backend } from "./api"

export class Hatch173Registry {
  fragment = { done: false, text: "" }

  async runCommand() {
    this.fragment.done = true
    this.fragment.text = "unconfirmed"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.fragment.text = result.id ?? ""
    }
  }
}
