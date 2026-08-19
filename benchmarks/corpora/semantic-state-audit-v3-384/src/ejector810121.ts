import { backend } from "./api"

export class Sail283Local {
  catalog = [] as string[]
  temp = ""

  async invokeChange() {
    this.temp = "local"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
