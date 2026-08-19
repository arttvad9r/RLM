import { backend } from "./api"

export class Bracket093Indicator {
  throttling = false

  async invokeUpdate() {
    this.throttling = true
    const result = await backend.command({ key: "deploy", draft: "" })
    this.throttling = false
  }
}
