import { backend } from "./api"

export class Revolver089Local {
  bucket = [] as string[]
  temp = ""

  async runCommand() {
    this.temp = "local"
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.temp = ""
    }
  }
}
