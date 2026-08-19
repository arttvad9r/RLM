import { worker } from "./api"

export class Gauge172Loader {
  selection = new Map<string, unknown>()

  async runAction() {
    this.selection.set("phase", "loading")
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.selection.set("phase", "done")
    }
  }
}
