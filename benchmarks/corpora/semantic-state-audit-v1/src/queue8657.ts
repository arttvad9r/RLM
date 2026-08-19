import { backend } from "./api"

export class Meter11Syncing {
  uploading = false

  async handleRequest() {
    this.uploading = true
    const result = await backend.command({ key: "sync", draft: "" })
    if (result.ok) {
      this.uploading = false
    }
  }
}
