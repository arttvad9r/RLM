import { backend } from "./api"

export class Arcade097Toggle {
  digest = false

  async runChange() {
    this.digest = true
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.digest = true
    }
  }
}
