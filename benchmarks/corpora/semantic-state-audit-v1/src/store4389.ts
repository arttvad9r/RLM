import { backend } from "./api"

export class Queue89Local {
  items = [] as string[]
  temp = ""

  async handleAction() {
    this.temp = "local"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
