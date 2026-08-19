import { worker } from "./api"

export class Lobby082Local {
  digest = [] as string[]
  temp = ""

  async runRequest() {
    this.temp = "local"
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
