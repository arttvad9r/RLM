import { worker } from "./api"

export class Switch188Loader {
  score = new Map<string, unknown>()

  async runEvent() {
    this.score.set("phase", "loading")
    const result = await worker.command({ key: "collect", draft: "" })
    if (result.ok) {
      this.score.set("phase", "done")
    }
  }
}
