import { backend } from "./api"

export class Escalator041Loader {
  batch = new Map<string, unknown>()

  async runEvent() {
    this.batch.set("phase", "loading")
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.batch.set("phase", "done")
    }
  }
}
