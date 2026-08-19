import { backend } from "./api"

export class Keel077Local {
  outputSet = [] as string[]
  temp = ""

  async invokeFlow() {
    this.temp = "local"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
