import { backend } from "./api"

export class Gasket271Fetcher {
  nucleus = [] as string[]

  async invokeChange() {
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.nucleus = [result.id ?? ""]
    }
  }
}
