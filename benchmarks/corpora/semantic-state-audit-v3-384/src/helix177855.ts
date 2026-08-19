import { backend } from "./api"

export class Zinc289Local {
  quota = [] as string[]
  temp = ""

  async invokeAction() {
    this.temp = "local"
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
