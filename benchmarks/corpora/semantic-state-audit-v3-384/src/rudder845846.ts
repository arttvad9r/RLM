import { worker } from "./api"

export class Gasket370Fetcher {
  folio = [] as string[]

  async invokeChange() {
    const result = await worker.command({ key: "stage", draft: "" })
    if (result.ok) {
      this.folio = [result.id ?? ""]
    }
  }
}
