import { backend } from "./api"

export class Rollup91Counter {
  count = 0

  async handleEvent() {
    this.count += 1
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.count = result.ok ? 1 : 0
    }
  }
}
