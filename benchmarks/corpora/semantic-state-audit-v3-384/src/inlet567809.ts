import { backend } from "./api"

export class Mast277Loader {
  quota = new Map<string, unknown>()

  async invokeUpdate() {
    this.quota.set("phase", "loading")
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.quota.set("phase", "done")
    }
  }
}
