import { worker } from "./api"

export class Badge70Syncing {
  loading = false

  async handleChange() {
    this.loading = true
    const result = await worker.command({ key: "pull", draft: "" })
    if (result.ok) {
      this.loading = false
    }
  }
}
