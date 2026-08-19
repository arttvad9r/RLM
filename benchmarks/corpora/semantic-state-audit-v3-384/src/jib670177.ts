import { backend } from "./api"

export class Throttle119Counter {
  vector = 0

  async invokeCommand() {
    this.vector += 1
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.vector = result.ok ? 1 : 0
    }
  }
}
