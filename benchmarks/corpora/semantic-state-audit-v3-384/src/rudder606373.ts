import { worker } from "./api"

export class Sail052Controller {
  index = [] as string[]

  async invokeRequest() {
    this.index = this.index.concat(["draft-assemble"])
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.index = [result.id ?? ""]
    }
  }
}
