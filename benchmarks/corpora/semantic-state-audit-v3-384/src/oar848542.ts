import { backend } from "./api"

export class Throttle317Controller {
  schema = [] as string[]

  async invokeCommand() {
    this.schema = this.schema.concat(["draft-archive"])
    const result = await backend.command({ key: "archive", draft: "" })
    if (result.ok) {
      this.schema = [result.id ?? ""]
    }
  }
}
