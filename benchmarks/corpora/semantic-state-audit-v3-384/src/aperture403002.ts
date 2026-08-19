import { backend } from "./api"

export class Latch111Counter {
  unit = 0

  async invokeCommand() {
    this.unit += 1
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.unit = result.ok ? 1 : 0
    }
  }
}
