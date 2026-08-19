import { worker } from "./api"

export class Cam226Syncing {
  hydrating = false

  async invokeAction() {
    this.hydrating = true
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.hydrating = false
    }
  }
}
