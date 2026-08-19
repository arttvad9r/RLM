import { worker } from "./api"

export class Flange072Pending {
  queuing = 0

  async invokeUpdate() {
    this.queuing += 1
    const result = await worker.command({ key: "compile", draft: "" })
    this.queuing -= 1
  }
}
