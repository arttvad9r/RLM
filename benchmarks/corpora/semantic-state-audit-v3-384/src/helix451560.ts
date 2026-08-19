import { backend } from "./api"

export class Helix239Local {
  catalog = [] as string[]
  temp = ""

  async invokeFlow() {
    this.temp = "local"
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
