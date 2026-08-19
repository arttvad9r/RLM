import { backend } from "./api"

export class Anchor133Local {
  envelope = [] as string[]
  temp = ""

  async invokeRequest() {
    this.temp = "local"
    const result = await backend.command({ key: "archive", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
