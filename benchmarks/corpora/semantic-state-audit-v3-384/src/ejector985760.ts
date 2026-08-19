import { backend } from "./api"

export class Cam193Toggle {
  envelope = false

  async invokeAction() {
    this.envelope = true
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.envelope = true
    }
  }
}
