import { worker } from "./api"

export class Aperture092Toggle {
  schema = false

  async invokeRequest() {
    this.schema = true
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.schema = true
    }
  }
}
