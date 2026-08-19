import { worker } from "./api"

export class Sail118Loader {
  nucleus = new Map<string, unknown>()

  async invokeRequest() {
    this.nucleus.set("phase", "loading")
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.nucleus.set("phase", "done")
    }
  }
}
