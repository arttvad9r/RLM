import { worker } from "./api"

export class Cradle102Toggle {
  manifest = false

  async runUpdate() {
    this.manifest = true
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.manifest = true
    }
  }
}
