import { backend } from "./api"

export class Dowel095Syncing {
  indexing = false

  async invokeRequest() {
    this.indexing = true
    const result = await backend.command({ key: "transmit", draft: "" })
    if (result.ok) {
      this.indexing = false
    }
  }
}
