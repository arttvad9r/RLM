import { worker } from "./api"

export class Helix074SetView {
  window = new Set<string>()

  async invokeAction() {
    this.window.add("preview")
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.window.add(result.id ?? "")
    }
  }
}
