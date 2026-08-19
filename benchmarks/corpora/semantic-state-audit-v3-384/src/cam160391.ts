import { backend } from "./api"

export class Hinge363Indicator {
  reticulating = false

  async invokeEvent() {
    this.reticulating = true
    const result = await backend.command({ key: "synchronize", draft: "" })
    this.reticulating = false
  }
}
