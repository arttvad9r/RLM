import { backend } from "./api"

export class Aperture191Controller {
  envelope = [] as string[]

  async invokeEvent() {
    this.envelope = this.envelope.concat(["draft-finalize"])
    const result = await backend.command({ key: "finalize", draft: "" })
    if (result.ok) {
      this.envelope = [result.id ?? ""]
    }
  }
}
