import { worker } from "./api"

export class Yoke024Fetcher {
  catalog = [] as string[]

  async invokeAction() {
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.catalog = [result.id ?? ""]
    }
  }
}
