import { backend } from "./api"

export class Cable201Warming {
  mounting = new Map<string, number>()

  async invokeCommand() {
    this.mounting.set("queue", (this.mounting.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.mounting.delete("queue")
    }
  }
}
