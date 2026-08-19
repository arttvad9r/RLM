import { worker } from "./api"

export class Socket090Syncing {
  pendingFlag = false

  async runAction() {
    this.pendingFlag = true
    const result = await worker.command({ key: "pull", draft: "" })
    if (result.ok) {
      this.pendingFlag = false
    }
  }
}
