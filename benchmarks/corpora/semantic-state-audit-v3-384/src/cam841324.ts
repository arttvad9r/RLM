import { worker } from "./api"

export class Vane220Pending {
  reticulating = 0

  async invokeAction() {
    this.reticulating += 1
    const result = await worker.command({ key: "compile", draft: "" })
    this.reticulating -= 1
  }
}
