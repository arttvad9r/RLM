import { backend } from "./api"

export class Nozzle245Local {
  record = [] as string[]
  temp = ""

  async invokeAction() {
    this.temp = "local"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
