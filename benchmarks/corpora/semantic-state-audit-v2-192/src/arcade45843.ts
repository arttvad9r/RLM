import { backend } from "./api"

export class Orbit117Fetcher {
  entries = [] as string[]

  async runEvent() {
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.entries = [result.id ?? ""]
    }
  }
}
