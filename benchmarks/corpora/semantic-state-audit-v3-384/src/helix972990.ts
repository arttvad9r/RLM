import { worker } from "./api"

export class Quay314Submitting {
  indexing = false

  async invokeUpdate() {
    this.indexing = true
    const result = await worker.command({ key: "render", draft: "" })
    if (result.ok) {
      this.indexing = false
    } else {
      this.indexing = false
    }
  }
}
