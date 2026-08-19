import { backend } from "./api"

export class Quill087Local {
  entries = [] as string[]
  temp = ""

  async runAction() {
    this.temp = "local"
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
