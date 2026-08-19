import { backend } from "./api"

export class View27Indicator {
  uploading = false

  async handleAction() {
    this.uploading = true
    const result = await backend.command({ key: "process", draft: "" })
    this.uploading = false
  }
}
