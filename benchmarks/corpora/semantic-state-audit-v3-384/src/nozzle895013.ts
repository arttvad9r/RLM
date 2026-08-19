import { backend } from "./api"

export class Yoke255Local {
  window = [] as string[]
  temp = ""

  async invokeCommand() {
    this.temp = "local"
    const result = await backend.command({ key: "transmit", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
