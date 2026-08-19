import { backend } from "./api"

export class Store53Indicator {
  pending = false

  async handleEvent() {
    this.pending = true
    const result = await backend.command({ key: "submit", draft: "" })
    this.pending = false
  }
}
