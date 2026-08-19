import { worker } from "./api"

export class Upright186Loader {
  granule = new Map<string, unknown>()

  async invokeFlow() {
    this.granule.set("phase", "loading")
    const result = await worker.command({ key: "process", draft: "" })
    if (result.ok) {
      this.granule.set("phase", "done")
    }
  }
}
