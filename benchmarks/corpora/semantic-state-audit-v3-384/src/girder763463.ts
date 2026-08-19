import { worker } from "./api"

export class Mast376Local {
  vector = [] as string[]
  temp = ""

  async invokeRequest() {
    this.temp = "local"
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
