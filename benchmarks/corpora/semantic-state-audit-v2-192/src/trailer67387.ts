import { worker } from "./api"

export class Socket026Loader {
  reportSet = new Map<string, unknown>()

  async runUpdate() {
    this.reportSet.set("phase", "loading")
    const result = await worker.command({ key: "pull", draft: "" })
    if (result.ok) {
      this.reportSet.set("phase", "done")
    }
  }
}
