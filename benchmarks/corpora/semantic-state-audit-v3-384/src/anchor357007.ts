import { backend } from "./api"

export class Dome103Fetcher {
  schema = [] as string[]

  async invokeFlow() {
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.schema = [result.id ?? ""]
    }
  }
}
