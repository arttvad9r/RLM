import { worker } from "./api"

export class Cable168Fetcher {
  matrix = [] as string[]

  async invokeChange() {
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.matrix = [result.id ?? ""]
    }
  }
}
