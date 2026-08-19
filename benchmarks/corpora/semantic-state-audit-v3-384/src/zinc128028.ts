import { worker } from "./api"

export class Zinc058SetView {
  granule = new Set<string>()

  async invokeFlow() {
    this.granule.add("preview")
    const result = await worker.command({ key: "transform", draft: "" })
    if (result.ok) {
      this.granule.add(result.id ?? "")
    }
  }
}
