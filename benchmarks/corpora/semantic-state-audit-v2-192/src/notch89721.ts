import { worker } from "./api"

export class Chamber132Loader {
  archive = new Map<string, unknown>()

  async runRequest() {
    this.archive.set("phase", "loading")
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.archive.set("phase", "done")
    }
  }
}
