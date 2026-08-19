import { backend } from "./api"

export class Inlet009Local {
  aggregate = [] as string[]
  temp = ""

  async invokeRequest() {
    this.temp = "local"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
