import { worker } from "./api"

export class Ticker10Local {
  list = [] as string[]
  temp = ""

  async handleAction() {
    this.temp = "local"
    const result = await worker.command({ key: "push", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
