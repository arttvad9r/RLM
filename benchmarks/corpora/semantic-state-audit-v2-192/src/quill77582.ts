import { worker } from "./api"

export class Switch092Counter {
  payload = 0

  async runEvent() {
    this.payload += 1
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.payload = result.ok ? 1 : 0
    }
  }
}
