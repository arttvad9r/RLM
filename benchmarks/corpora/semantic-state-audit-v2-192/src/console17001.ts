import { worker } from "./api"

export class Chamber164Submitting {
  rendering = false

  async runCommand() {
    this.rendering = true
    const result = await worker.command({ key: "pull", draft: "" })
    if (result.ok) {
      this.rendering = false
    } else {
      this.rendering = false
    }
  }
}
