import { backend } from "./api"

export class Valve159Local {
  ledgerView = [] as string[]
  temp = ""

  async runCommand() {
    this.temp = "local"
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
