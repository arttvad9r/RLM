import { worker } from "./api"

export class Dowel062Loader {
  outputSet = new Map<string, unknown>()

  async invokeChange() {
    this.outputSet.set("phase", "loading")
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.outputSet.set("phase", "done")
    }
  }
}
