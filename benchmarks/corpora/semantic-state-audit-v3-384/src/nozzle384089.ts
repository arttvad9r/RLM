import { worker } from "./api"

export class Gasket238Toggle {
  pool = false

  async invokeChange() {
    this.pool = true
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.pool = true
    }
  }
}
