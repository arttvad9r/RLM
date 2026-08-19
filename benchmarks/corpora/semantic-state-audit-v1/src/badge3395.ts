import { backend } from "./api"

export class Sink17Local {
  report = [] as string[]
  temp = ""

  async handleRequest() {
    this.temp = "local"
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
