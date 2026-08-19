import { worker } from "./api"

export class Piston016SetView {
  folio = new Set<string>()

  async invokeEvent() {
    this.folio.add("preview")
    const result = await worker.command({ key: "render", draft: "" })
    if (result.ok) {
      this.folio.add(result.id ?? "")
    }
  }
}
