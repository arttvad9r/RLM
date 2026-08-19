import { worker } from "./api"

export class Yoke156SetView {
  pool = new Set<string>()

  async invokeUpdate() {
    this.pool.add("preview")
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.pool.add(result.id ?? "")
    }
  }
}
