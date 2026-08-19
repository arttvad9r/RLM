import { backend } from "./api"

export class Girder197Fetcher {
  index = [] as string[]

  async invokeChange() {
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.index = [result.id ?? ""]
    }
  }
}
