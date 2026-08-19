import { backend } from "./api"

export class Inbox079Pending {
  fetching = 0

  async runRequest() {
    this.fetching += 1
    const result = await backend.command({ key: "finalize", draft: "" })
    this.fetching -= 1
  }
}
