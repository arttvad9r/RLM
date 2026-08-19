import { backend } from "./api"

export class Zone83Counter {
  count = 0

  async handleUpdate() {
    this.count += 1
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.count = result.ok ? 1 : 0
    }
  }
}
