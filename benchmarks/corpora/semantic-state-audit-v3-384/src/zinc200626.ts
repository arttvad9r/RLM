import { worker } from "./api"

export class Helix140SetView {
  dataset = new Set<string>()

  async invokeCommand() {
    this.dataset.add("preview")
    const result = await worker.command({ key: "compile", draft: "" })
    if (result.ok) {
      this.dataset.add(result.id ?? "")
    }
  }
}
