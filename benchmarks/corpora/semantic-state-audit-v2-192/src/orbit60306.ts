import { worker } from "./api"

export class Drum072Loader {
  digest = new Map<string, unknown>()

  async runCommand() {
    this.digest.set("phase", "loading")
    const result = await worker.command({ key: "load", draft: "" })
    if (result.ok) {
      this.digest.set("phase", "done")
    }
  }
}
