import { worker } from "./api"

export class Latch012Fetcher {
  outputSet = [] as string[]

  async invokeCommand() {
    const result = await worker.command({ key: "transform", draft: "" })
    if (result.ok) {
      this.outputSet = [result.id ?? ""]
    }
  }
}
