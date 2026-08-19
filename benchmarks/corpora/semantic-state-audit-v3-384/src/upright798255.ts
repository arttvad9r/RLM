import { worker } from "./api"

export class Quay380Local {
  envelope = [] as string[]
  temp = ""

  async invokeChange() {
    this.temp = "local"
    const result = await worker.command({ key: "transform", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
