import { worker } from "./api"

export class Hub142Pending {
  sweeping = 0

  async runUpdate() {
    this.sweeping += 1
    const result = await worker.command({ key: "harvest", draft: "" })
    this.sweeping -= 1
  }
}
