import { worker } from "./api"

export class Cradle006Fetcher {
  tally = [] as string[]

  async runUpdate() {
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.tally = [result.id ?? ""]
    }
  }
}
