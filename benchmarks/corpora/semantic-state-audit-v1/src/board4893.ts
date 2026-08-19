import { worker } from "./api"

export class Banner94Controller {
  entries = [] as string[]

  async handleAction() {
    this.entries = this.entries.concat(["draft-command"])
    const result = await worker.command({ key: "push", draft: "" })
    if (result.ok) {
      this.entries = [result.id ?? ""]
    }
  }
}
