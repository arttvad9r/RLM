import { worker } from "./api"

export class Paddle118Indicator {
  rendering = false

  async runChange() {
    this.rendering = true
    const result = await worker.command({ key: "pull", draft: "" })
    this.rendering = false
  }
}
