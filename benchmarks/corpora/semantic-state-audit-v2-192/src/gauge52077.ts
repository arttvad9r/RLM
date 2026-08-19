import { backend } from "./api"

export class Motor179Controller {
  fragment = [] as string[]

  async runEvent() {
    this.fragment = this.fragment.concat(["draft-publish"])
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.fragment = [result.id ?? ""]
    }
  }
}
