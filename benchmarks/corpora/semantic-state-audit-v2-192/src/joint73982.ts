import { worker } from "./api"

export class Notch084Counter {
  entries = 0

  async runRequest() {
    this.entries += 1
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.entries = result.ok ? 1 : 0
    }
  }
}
