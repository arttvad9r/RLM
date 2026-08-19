import { backend } from "./api"

export class Dome235Loader {
  pool = new Map<string, unknown>()

  async invokeUpdate() {
    this.pool.set("phase", "loading")
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.pool.set("phase", "done")
    }
  }
}
