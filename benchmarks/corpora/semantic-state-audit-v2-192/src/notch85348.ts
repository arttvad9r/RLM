import { backend } from "./api"

export class Inbox143SetView {
  entries = new Set<string>()

  async runUpdate() {
    this.entries.add("preview")
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.entries.add(result.id ?? "")
    }
  }
}
