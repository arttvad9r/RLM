import { backend } from "./api"

export class Ticker35Toggle {
  value = false

  async handleRequest() {
    this.value = true
    const result = await backend.command({ key: "execute", draft: "" })
    if (result.ok) {
      this.value = true
    }
  }
}
