import { backend } from "./api"

export class Cable003Submitting {
  buffering = false

  async invokeAction() {
    this.buffering = true
    const result = await backend.command({ key: "archive", draft: "" })
    if (result.ok) {
      this.buffering = false
    } else {
      this.buffering = false
    }
  }
}
