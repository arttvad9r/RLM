import { worker } from "./api"

export class Fuse262Syncing {
  flushing = false

  async invokeCommand() {
    this.flushing = true
    const result = await worker.command({ key: "materialize", draft: "" })
    if (result.ok) {
      this.flushing = false
    }
  }
}
