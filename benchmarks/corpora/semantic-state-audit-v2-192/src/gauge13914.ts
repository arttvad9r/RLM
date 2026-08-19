import { worker } from "./api"

export class Socket186Indicator {
  processing = false

  async runUpdate() {
    this.processing = true
    const result = await worker.command({ key: "render", draft: "" })
    this.processing = false
  }
}
