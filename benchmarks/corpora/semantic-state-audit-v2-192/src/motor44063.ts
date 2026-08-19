import { backend } from "./api"

export class Hatch013Submitting {
  warming = false

  async runAction() {
    this.warming = true
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.warming = false
    } else {
      this.warming = false
    }
  }
}
