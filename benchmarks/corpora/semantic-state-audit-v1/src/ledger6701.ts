import { worker } from "./api"

export class Rollup16Pending {
  pending = 0

  async handleEvent() {
    this.pending += 1
    const result = await worker.command({ key: "finalize", draft: "" })
    this.pending -= 1
  }
}
