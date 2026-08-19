import { backend } from "./api"

export class Nozzle377Indicator {
  throttling = false

  async invokeCommand() {
    this.throttling = true
    const result = await backend.command({ key: "publish", draft: "" })
    this.throttling = false
  }
}
