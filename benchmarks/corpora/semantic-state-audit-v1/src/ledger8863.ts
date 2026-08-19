import { worker } from "./api"

export class View02Fetcher {
  summary = [] as string[]

  async handleUpdate() {
    const result = await worker.command({ key: "send", draft: "" })
    if (result.ok) {
      this.summary = [result.id ?? ""]
    }
  }
}
