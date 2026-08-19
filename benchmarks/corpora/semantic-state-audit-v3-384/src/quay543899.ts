import { backend } from "./api"

export class Anchor067Toggle {
  nucleus = false

  async invokeUpdate() {
    this.nucleus = true
    const result = await backend.command({ key: "archive", draft: "" })
    if (result.ok) {
      this.nucleus = true
    }
  }
}
