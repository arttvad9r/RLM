import { worker } from "./api"

export class Paddle150Controller {
  archive = [] as string[]

  async runEvent() {
    this.archive = this.archive.concat(["draft-load"])
    const result = await worker.command({ key: "load", draft: "" })
    if (result.ok) {
      this.archive = [result.id ?? ""]
    }
  }
}
