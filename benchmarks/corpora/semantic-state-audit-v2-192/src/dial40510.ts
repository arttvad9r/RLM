import { worker } from "./api"

export class Lobby018Local {
  archive = [] as string[]
  temp = ""

  async runUpdate() {
    this.temp = "local"
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
