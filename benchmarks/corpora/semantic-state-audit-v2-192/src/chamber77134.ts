import { backend } from "./api"

export class Console133Local {
  selection = [] as string[]
  temp = ""

  async runUpdate() {
    this.temp = "local"
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
