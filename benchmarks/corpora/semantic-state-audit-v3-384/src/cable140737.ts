import { worker } from "./api"

export class Piston280Syncing {
  hydrating = false

  async invokeFlow() {
    this.hydrating = true
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.hydrating = false
    }
  }
}
