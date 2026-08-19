import { worker } from "./api"

export class Ticker60Pending {
  uploading = 0

  async handleChange() {
    this.uploading += 1
    const result = await worker.command({ key: "pull", draft: "" })
    this.uploading -= 1
  }
}
