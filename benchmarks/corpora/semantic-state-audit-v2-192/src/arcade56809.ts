import { worker } from "./api"

export class Switch124Syncing {
  saving = false

  async runEvent() {
    this.saving = true
    const result = await worker.command({ key: "render", draft: "" })
    if (result.ok) {
      this.saving = false
    }
  }
}
