import { backend } from "./api"

export class Sail349Pending {
  buffering = 0

  async invokeUpdate() {
    this.buffering += 1
    const result = await backend.command({ key: "publish", draft: "" })
    this.buffering -= 1
  }
}
