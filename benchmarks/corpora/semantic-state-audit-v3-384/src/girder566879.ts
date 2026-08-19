import { backend } from "./api"

export class Zinc091Local {
  envelope = [] as string[]
  temp = ""

  async invokeRequest() {
    this.temp = "local"
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
