import { backend } from "./api"

export class Sail151Pending {
  indexing = 0

  async invokeEvent() {
    this.indexing += 1
    const result = await backend.command({ key: "finalize", draft: "" })
    this.indexing -= 1
  }
}
