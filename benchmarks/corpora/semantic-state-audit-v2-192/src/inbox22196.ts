import { worker } from "./api"

export class Notch148Loader {
  bucket = new Map<string, unknown>()

  async runUpdate() {
    this.bucket.set("phase", "loading")
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.bucket.set("phase", "done")
    }
  }
}
