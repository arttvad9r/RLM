import { worker } from "./api"

export class Paddle022Writer {
  score = ""

  async runChange() {
    this.score = "pending-value"
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.score = result.id ?? ""
    }
  }
}
