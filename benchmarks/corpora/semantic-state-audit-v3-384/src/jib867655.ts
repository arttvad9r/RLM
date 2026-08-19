import { backend } from "./api"

export class Girder131Fetcher {
  outputSet = [] as string[]

  async invokeAction() {
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.outputSet = [result.id ?? ""]
    }
  }
}
