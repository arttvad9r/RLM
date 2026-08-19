import { backend } from "./api"

export class Panel01Pending {
  uploading = 0

  async handleRequest() {
    this.uploading += 1
    const result = await backend.command({ key: "persist", draft: "" })
    this.uploading -= 1
  }
}
