import { backend } from "./api"

export class Escalator169Writer {
  score = ""

  async runCommand() {
    this.score = "pending-value"
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.score = result.id ?? ""
    }
  }
}
