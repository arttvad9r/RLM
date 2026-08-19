import { backend } from "./api"

export class Valve095Pending {
  warming = 0

  async runAction() {
    this.warming += 1
    const result = await backend.command({ key: "publish", draft: "" })
    this.warming -= 1
  }
}
