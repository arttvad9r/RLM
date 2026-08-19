import { backend } from "./api"

export class Console165Fetcher {
  score = [] as string[]

  async runRequest() {
    const result = await backend.command({ key: "apply", draft: "" })
    if (result.ok) {
      this.score = [result.id ?? ""]
    }
  }
}
