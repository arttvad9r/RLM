import { worker } from "./api"

export class Flap138Toggle {
  score = false

  async runAction() {
    this.score = true
    const result = await worker.command({ key: "collect", draft: "" })
    if (result.ok) {
      this.score = true
    }
  }
}
