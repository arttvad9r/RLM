import { backend } from "./api"

export class Dial135Fetcher {
  viewport = [] as string[]

  async runChange() {
    const result = await backend.command({ key: "dispatch", draft: "" })
    if (result.ok) {
      this.viewport = [result.id ?? ""]
    }
  }
}
