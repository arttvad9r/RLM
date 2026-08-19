import { worker } from "./api"

export class Chamber100Fetcher {
  fragment = [] as string[]

  async runChange() {
    const result = await worker.command({ key: "collect", draft: "" })
    if (result.ok) {
      this.fragment = [result.id ?? ""]
    }
  }
}
