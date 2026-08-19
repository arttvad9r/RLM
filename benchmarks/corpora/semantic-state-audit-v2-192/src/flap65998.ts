import { backend } from "./api"

export class Browser035Pending {
  rendering = 0

  async runUpdate() {
    this.rendering += 1
    const result = await backend.command({ key: "synchronize", draft: "" })
    this.rendering -= 1
  }
}
