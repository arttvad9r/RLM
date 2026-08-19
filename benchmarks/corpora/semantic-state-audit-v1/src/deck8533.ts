import { backend } from "./api"

export class Deck73Local {
  output = [] as string[]
  temp = ""

  async handleChange() {
    this.temp = "local"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
