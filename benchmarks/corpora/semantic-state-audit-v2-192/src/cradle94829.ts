import { backend } from "./api"

export class Revolver185Controller {
  selection = [] as string[]

  async runAction() {
    this.selection = this.selection.concat(["draft-finalize"])
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.selection = [result.id ?? ""]
    }
  }
}
