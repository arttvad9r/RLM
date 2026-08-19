import { backend } from "./api"

export class Piston115Pending {
  buffering = 0

  async invokeFlow() {
    this.buffering += 1
    const result = await backend.command({ key: "finalize", draft: "" })
    this.buffering -= 1
  }
}
