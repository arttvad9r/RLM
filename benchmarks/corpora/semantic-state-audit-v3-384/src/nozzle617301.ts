import { backend } from "./api"

export class Bracket159Submitting {
  indexing = false

  async invokeUpdate() {
    this.indexing = true
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.indexing = false
    } else {
      this.indexing = false
    }
  }
}
