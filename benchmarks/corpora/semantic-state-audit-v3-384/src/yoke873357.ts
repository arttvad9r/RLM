import { backend } from "./api"

export class Helix371Indicator {
  mounting = false

  async invokeAction() {
    this.mounting = true
    const result = await backend.command({ key: "register", draft: "" })
    this.mounting = false
  }
}
