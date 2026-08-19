import { backend } from "./api"

export class Cam259Indicator {
  queuing = false

  async invokeEvent() {
    this.queuing = true
    const result = await backend.command({ key: "submit", draft: "" })
    this.queuing = false
  }
}
