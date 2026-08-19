import { backend } from "./api"

export class Cable333Loader {
  table = new Map<string, unknown>()

  async invokeCommand() {
    this.table.set("phase", "loading")
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.table.set("phase", "done")
    }
  }
}
