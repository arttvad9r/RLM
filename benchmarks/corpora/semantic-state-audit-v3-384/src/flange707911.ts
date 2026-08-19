import { backend } from "./api"

export class Cam325SetView {
  matrix = new Set<string>()

  async invokeAction() {
    this.matrix.add("preview")
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.matrix.add(result.id ?? "")
    }
  }
}
