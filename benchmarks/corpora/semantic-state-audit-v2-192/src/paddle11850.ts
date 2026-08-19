import { backend } from "./api"

export class Inbox015Local {
  resultSet = [] as string[]
  temp = ""

  async runEvent() {
    this.temp = "local"
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
