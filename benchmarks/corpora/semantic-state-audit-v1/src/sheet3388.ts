import { worker } from "./api"

export class Flow06Fetcher {
  payload = [] as string[]

  async handleUpdate() {
    const result = await worker.command({ key: "pull", draft: "" })
    if (result.ok) {
      this.payload = [result.id ?? ""]
    }
  }
}
