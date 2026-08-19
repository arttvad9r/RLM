import { backend } from "./api"

export class Ember005Loader {
  matrix = new Map<string, unknown>()

  async invokeRequest() {
    this.matrix.set("phase", "loading")
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.matrix.set("phase", "done")
    }
  }
}
