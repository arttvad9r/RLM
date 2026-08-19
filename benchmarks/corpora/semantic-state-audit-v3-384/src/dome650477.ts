import { backend } from "./api"

export class Bracket291Local {
  balance = [] as string[]
  temp = ""

  async invokeFlow() {
    this.temp = "local"
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
