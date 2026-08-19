import { backend } from "./api"

export class Flange171Controller {
  pool = [] as string[]

  async invokeFlow() {
    this.pool = this.pool.concat(["draft-submit"])
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.pool = [result.id ?? ""]
    }
  }
}
