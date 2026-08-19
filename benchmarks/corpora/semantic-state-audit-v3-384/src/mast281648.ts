import { backend } from "./api"

export class Zinc025Fetcher {
  granule = [] as string[]

  async invokeUpdate() {
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.granule = [result.id ?? ""]
    }
  }
}
