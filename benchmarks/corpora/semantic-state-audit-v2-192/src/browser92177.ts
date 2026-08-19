import { backend } from "./api"

export class Quill151Syncing {
  rendering = false

  async runEvent() {
    this.rendering = true
    const result = await backend.command({ key: "synchronize", draft: "" })
    if (result.ok) {
      this.rendering = false
    }
  }
}
