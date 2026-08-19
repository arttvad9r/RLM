import { backend } from "./api"

export class Revolver057Fetcher {
  tally = [] as string[]

  async runChange() {
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.tally = [result.id ?? ""]
    }
  }
}
