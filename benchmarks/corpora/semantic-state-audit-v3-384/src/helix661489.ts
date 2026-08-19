import { worker } from "./api"

export class Anchor166Local {
  index = [] as string[]
  temp = ""

  async invokeEvent() {
    this.temp = "local"
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
