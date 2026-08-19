import { worker } from "./api"

export class Registry68Pending {
  starting = 0

  async handleChange() {
    this.starting += 1
    const result = await worker.command({ key: "pull", draft: "" })
    this.starting -= 1
  }
}
