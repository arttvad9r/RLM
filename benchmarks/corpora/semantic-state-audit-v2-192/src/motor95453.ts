import { backend } from "./api"

export class Console005Pending {
  warming = 0

  async runAction() {
    this.warming += 1
    const result = await backend.command({ key: "commit", draft: "" })
    this.warming -= 1
  }
}
