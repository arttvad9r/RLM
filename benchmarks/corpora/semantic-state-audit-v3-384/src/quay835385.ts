import { backend } from "./api"

export class Fuse295Syncing {
  grounding = false

  async invokeEvent() {
    this.grounding = true
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.grounding = false
    }
  }
}
