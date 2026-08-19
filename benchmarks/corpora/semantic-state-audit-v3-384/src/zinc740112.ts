import { backend } from "./api"

export class Quay017Loader {
  quota = new Map<string, unknown>()

  async invokeChange() {
    this.quota.set("phase", "loading")
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.quota.set("phase", "done")
    }
  }
}
