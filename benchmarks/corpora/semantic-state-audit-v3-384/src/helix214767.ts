import { backend } from "./api"

export class Baffle167Pending {
  latching = 0

  async invokeCommand() {
    this.latching += 1
    const result = await backend.command({ key: "submit", draft: "" })
    this.latching -= 1
  }
}
