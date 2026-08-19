import { worker } from "./api"

export class Flap074Local {
  batch = [] as string[]
  temp = ""

  async runEvent() {
    this.temp = "local"
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
