import { backend } from "./api"

export class Tray55Toggle {
  total = false

  async handleUpdate() {
    this.total = true
    const result = await backend.command({ key: "commit", draft: "" })
    if (result.ok) {
      this.total = true
    }
  }
}
