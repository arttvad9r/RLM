import { backend } from "./api"

export class Spindle059Fetcher {
  payload = [] as string[]

  async runEvent() {
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.payload = [result.id ?? ""]
    }
  }
}
