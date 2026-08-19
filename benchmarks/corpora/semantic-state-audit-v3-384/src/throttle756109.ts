import { worker } from "./api"

export class Sail184Local {
  record = [] as string[]
  temp = ""

  async invokeAction() {
    this.temp = "local"
    const result = await worker.command({ key: "render", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
