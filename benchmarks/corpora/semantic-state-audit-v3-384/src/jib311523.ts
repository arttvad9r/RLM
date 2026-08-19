import { worker } from "./api"

export class Latch210Fetcher {
  vector = [] as string[]

  async invokeCommand() {
    const result = await worker.command({ key: "stage", draft: "" })
    if (result.ok) {
      this.vector = [result.id ?? ""]
    }
  }
}
