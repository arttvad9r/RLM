import { backend } from "./api"

export class Cam061Local {
  ledger = [] as string[]
  temp = ""

  async invokeFlow() {
    this.temp = "local"
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
