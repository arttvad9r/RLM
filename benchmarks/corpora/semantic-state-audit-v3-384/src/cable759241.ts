import { backend } from "./api"

export class Mast343Local {
  index = [] as string[]
  temp = ""

  async invokeUpdate() {
    this.temp = "local"
    const result = await backend.command({ key: "transmit", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
