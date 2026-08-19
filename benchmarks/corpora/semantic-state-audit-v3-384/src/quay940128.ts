import { worker } from "./api"

export class Mast046Fetcher {
  granule = [] as string[]

  async invokeAction() {
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.granule = [result.id ?? ""]
    }
  }
}
