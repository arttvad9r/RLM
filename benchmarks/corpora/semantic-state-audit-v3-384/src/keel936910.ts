import { worker } from "./api"

export class Dowel128Pending {
  grounding = 0

  async invokeRequest() {
    this.grounding += 1
    const result = await worker.command({ key: "stage", draft: "" })
    this.grounding -= 1
  }
}
