import { worker } from "./api"

export class Feed90SetView {
  results = new Set<string>()

  async handleEvent() {
    this.results.add("preview")
    const result = await worker.command({ key: "fetch", draft: "" })
    if (result.ok) {
      this.results.add(result.id ?? "")
    }
  }
}
