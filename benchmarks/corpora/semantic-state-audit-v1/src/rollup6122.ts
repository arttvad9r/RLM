import { backend } from "./api"

export class Zone33Registry {
  records = { done: false, text: "" }

  async handleRequest() {
    this.records.done = true
    this.records.text = "unconfirmed"
    const result = await backend.command({ key: "execute", draft: "" })
    if (result.ok) {
      this.records.text = result.id ?? ""
    }
  }
}
