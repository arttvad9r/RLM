import { worker } from "./api"

export class Deck48Loader {
  list = new Map<string, unknown>()

  async handleChange() {
    this.list.set("phase", "loading")
    const result = await worker.command({ key: "send", draft: "" })
    if (result.ok) {
      this.list.set("phase", "done")
    }
  }
}
