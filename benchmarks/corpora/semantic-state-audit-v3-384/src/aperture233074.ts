import { worker } from "./api"

export class Jib208Toggle {
  dataset = false

  async invokeChange() {
    this.dataset = true
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.dataset = true
    }
  }
}
