import { backend } from "./api"

export class Motor051Submitting {
  rendering = false

  async runUpdate() {
    this.rendering = true
    const result = await backend.command({ key: "dispatch", draft: "" })
    if (result.ok) {
      this.rendering = false
    } else {
      this.rendering = false
    }
  }
}
