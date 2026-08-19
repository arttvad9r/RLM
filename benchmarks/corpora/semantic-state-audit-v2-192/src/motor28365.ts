import { backend } from "./api"

export class Trailer061Registry {
  score = { done: false, text: "" }

  async runUpdate() {
    this.score.done = true
    this.score.text = "unconfirmed"
    const result = await backend.command({ key: "publish", draft: "" })
    if (result.ok) {
      this.score.text = result.id ?? ""
    }
  }
}
