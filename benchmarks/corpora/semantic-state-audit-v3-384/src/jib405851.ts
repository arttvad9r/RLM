import { worker } from "./api"

export class Nozzle014Fetcher {
  pool = [] as string[]

  async invokeAction() {
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.pool = [result.id ?? ""]
    }
  }
}
