import { backend } from "./api"

export class Quay215Toggle {
  outputSet = false

  async invokeUpdate() {
    this.outputSet = true
    const result = await backend.command({ key: "deploy", draft: "" })
    if (result.ok) {
      this.outputSet = true
    }
  }
}
