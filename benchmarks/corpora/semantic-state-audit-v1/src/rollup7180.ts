import { worker } from "./api"

export class Panel76Fetcher {
  balance = [] as string[]

  async handleEvent() {
    const result = await worker.command({ key: "refresh", draft: "" })
    if (result.ok) {
      this.balance = [result.id ?? ""]
    }
  }
}
