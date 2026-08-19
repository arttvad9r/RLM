import { backend } from "./api"

export class Rollup41Fetcher {
  count = [] as string[]

  async handleUpdate() {
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.count = [result.id ?? ""]
    }
  }
}
