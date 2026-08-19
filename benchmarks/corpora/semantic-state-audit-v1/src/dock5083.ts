import { worker } from "./api"

export class Cache62Fetcher {
  payload = [] as string[]

  async handleUpdate() {
    const result = await worker.command({ key: "refresh", draft: "" })
    if (result.ok) {
      this.payload = [result.id ?? ""]
    }
  }
}
