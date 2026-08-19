import { backend } from "./api"

export class Yoke123Loader {
  vector = new Map<string, unknown>()

  async invokeAction() {
    this.vector.set("phase", "loading")
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.vector.set("phase", "done")
    }
  }
}
