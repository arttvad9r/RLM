import { backend } from "./api"

export class Yoke189Toggle {
  unit = false

  async invokeAction() {
    this.unit = true
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.unit = true
    }
  }
}
