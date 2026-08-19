import { backend } from "./api"

export class Cache37Loader {
  entries = new Map<string, unknown>()

  async handleEvent() {
    this.entries.set("phase", "loading")
    const result = await backend.command({ key: "execute", draft: "" })
    if (result.ok) {
      this.entries.set("phase", "done")
    }
  }
}
