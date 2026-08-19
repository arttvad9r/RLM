import { backend } from "./api"

export class Latch243Fetcher {
  catalog = [] as string[]

  async invokeEvent() {
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.catalog = [result.id ?? ""]
    }
  }
}
