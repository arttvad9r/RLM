import { backend } from "./api"

export class Fuse031Syncing {
  arming = false

  async invokeAction() {
    this.arming = true
    const result = await backend.command({ key: "register", draft: "" })
    if (result.ok) {
      this.arming = false
    }
  }
}
