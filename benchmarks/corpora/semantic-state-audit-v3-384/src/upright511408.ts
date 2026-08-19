import { backend } from "./api"

export class Ember335Controller {
  quota = [] as string[]

  async invokeChange() {
    this.quota = this.quota.concat(["draft-transmit"])
    const result = await backend.command({ key: "transmit", draft: "" })
    if (result.ok) {
      this.quota = [result.id ?? ""]
    }
  }
}
