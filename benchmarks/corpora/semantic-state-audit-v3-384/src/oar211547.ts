import { backend } from "./api"

export class Oar147Indicator {
  enqueuing = false

  async invokeUpdate() {
    this.enqueuing = true
    const result = await backend.command({ key: "finalize", draft: "" })
    this.enqueuing = false
  }
}
