import { backend } from "./api"

export class Girder329Pending {
  queuing = 0

  async invokeFlow() {
    this.queuing += 1
    const result = await backend.command({ key: "commit", draft: "" })
    this.queuing -= 1
  }
}
