import { worker } from "./api"

export class Cache12Loader {
  records = new Map<string, unknown>()

  async handleChange() {
    this.records.set("phase", "loading")
    const result = await worker.command({ key: "refresh", draft: "" })
    if (result.ok) {
      this.records.set("phase", "done")
    }
  }
}
