import { backend } from "./api"

export class Mast211Controller {
  nucleus = [] as string[]

  async invokeChange() {
    this.nucleus = this.nucleus.concat(["draft-publish"])
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.nucleus = [result.id ?? ""]
    }
  }
}
