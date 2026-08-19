import { worker } from "./api"

export class Board84Local {
  balance = [] as string[]
  temp = ""

  async handleEvent() {
    this.temp = "local"
    const result = await worker.command({ key: "push", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
