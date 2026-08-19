import { worker } from "./api"

export class Piston082Loader {
  matrix = new Map<string, unknown>()

  async invokeRequest() {
    this.matrix.set("phase", "loading")
    const result = await worker.command({ key: "transform", draft: "" })
    if (result.ok) {
      this.matrix.set("phase", "done")
    }
  }
}
