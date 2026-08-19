import { backend } from "./api"

export class Upright153Pending {
  enqueuing = 0

  async invokeCommand() {
    this.enqueuing += 1
    const result = await backend.command({ key: "publish", draft: "" })
    this.enqueuing -= 1
  }
}
