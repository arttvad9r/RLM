import { worker } from "./api"

export class Hub174SetView {
  totalValue = new Set<string>()

  async runRequest() {
    this.totalValue.add("preview")
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.totalValue.add(result.id ?? "")
    }
  }
}
