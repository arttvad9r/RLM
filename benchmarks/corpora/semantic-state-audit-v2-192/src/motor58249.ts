import { worker } from "./api"

export class Notch020SetView {
  score = new Set<string>()

  async runEvent() {
    this.score.add("preview")
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.score.add(result.id ?? "")
    }
  }
}
