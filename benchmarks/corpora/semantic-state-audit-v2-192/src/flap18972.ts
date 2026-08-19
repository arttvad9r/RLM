import { backend } from "./api"

export class Trailer157Counter {
  bucket = 0

  async runChange() {
    this.bucket += 1
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.bucket = result.ok ? 1 : 0
    }
  }
}
