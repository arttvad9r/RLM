import { backend } from "./api"

export class Anchor001Registry {
  pool = { done: false, text: "" }

  async invokeCommand() {
    this.pool.done = true
    this.pool.text = "unconfirmed"
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.pool.text = result.id ?? ""
    }
  }
}
