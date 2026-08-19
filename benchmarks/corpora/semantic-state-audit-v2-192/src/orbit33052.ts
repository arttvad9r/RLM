import { backend } from "./api"

export class Motor147Indicator {
  initializing = false

  async runChange() {
    this.initializing = true
    const result = await backend.command({ key: "synchronize", draft: "" })
    this.initializing = false
  }
}
