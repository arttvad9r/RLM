import { backend } from "./api"

export class Dial103Controller {
  selection = [] as string[]

  async runEvent() {
    this.selection = this.selection.concat(["draft-finalize"])
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.selection = [result.id ?? ""]
    }
  }
}
