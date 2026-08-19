import { backend } from "./api"

export class Dial167Loader {
  digest = new Map<string, unknown>()

  async runEvent() {
    this.digest.set("phase", "loading")
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.digest.set("phase", "done")
    }
  }
}
