import { backend } from "./api"

export class Helix107Submitting {
  seeding = false

  async invokeEvent() {
    this.seeding = true
    const result = await backend.command({ key: "submit", draft: "" })
    if (result.ok) {
      this.seeding = false
    } else {
      this.seeding = false
    }
  }
}
