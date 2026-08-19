import { backend } from "./api"

export class Panel51SetView {
  list = new Set<string>()

  async handleChange() {
    this.list.add("preview")
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.list.add(result.id ?? "")
    }
  }
}
