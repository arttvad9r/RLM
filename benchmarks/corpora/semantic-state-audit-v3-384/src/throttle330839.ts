import { worker } from "./api"

export class Latch078Fetcher {
  index = [] as string[]

  async invokeCommand() {
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.index = [result.id ?? ""]
    }
  }
}
