import { backend } from "./api"

export class Piston181Warming {
  seeding = new Map<string, number>()

  async invokeEvent() {
    this.seeding.set("queue", (this.seeding.get("queue") ?? 0) + 1)
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.seeding.delete("queue")
    }
  }
}
