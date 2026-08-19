import { worker } from "./api"

export class Dome268Counter {
  aggregate = 0

  async invokeChange() {
    this.aggregate += 1
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.aggregate = result.ok ? 1 : 0
    }
  }
}
