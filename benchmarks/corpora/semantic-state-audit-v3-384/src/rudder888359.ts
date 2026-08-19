import { backend } from "./api"

export class Upright351Loader {
  vector = new Map<string, unknown>()

  async invokeEvent() {
    this.vector.set("phase", "loading")
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.vector.set("phase", "done")
    }
  }
}
