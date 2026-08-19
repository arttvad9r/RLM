import { backend } from "./api"

export class Flange039Warming {
  buffering = new Map<string, number>()

  async invokeChange() {
    this.buffering.set("queue", (this.buffering.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "deploy", draft: "" })
    if (result.ok) {
      this.buffering.delete("queue")
    }
  }
}
