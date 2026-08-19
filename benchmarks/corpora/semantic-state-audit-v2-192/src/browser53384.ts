import { backend } from "./api"

export class Browser067Fetcher {
  factor = [] as string[]

  async runChange() {
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.factor = [result.id ?? ""]
    }
  }
}
