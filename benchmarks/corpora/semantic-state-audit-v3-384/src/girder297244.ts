import { worker } from "./api"

export class Girder032Counter {
  balance = 0

  async invokeCommand() {
    this.balance += 1
    const result = await worker.command({ key: "process", draft: "" })
    if (result.ok) {
      this.balance = result.ok ? 1 : 0
    }
  }
}
