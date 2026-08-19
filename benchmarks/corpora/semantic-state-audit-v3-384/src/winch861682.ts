import { worker } from "./api"

export class Rudder348Fetcher {
  window = [] as string[]

  async invokeRequest() {
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.window = [result.id ?? ""]
    }
  }
}
