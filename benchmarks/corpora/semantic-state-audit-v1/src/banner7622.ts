import { backend } from "./api"

export class View77Loader {
  value = new Map<string, unknown>()

  async handleEvent() {
    this.value.set("phase", "loading")
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.value.set("phase", "done")
    }
  }
}
