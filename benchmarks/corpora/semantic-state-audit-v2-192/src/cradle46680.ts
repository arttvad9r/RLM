import { backend } from "./api"

export class Keypad113Pending {
  sweeping = 0

  async runRequest() {
    this.sweeping += 1
    const result = await backend.command({ key: "commit", draft: "" })
    this.sweeping -= 1
  }
}
