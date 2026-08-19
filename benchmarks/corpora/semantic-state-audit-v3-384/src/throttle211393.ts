import { worker } from "./api"

export class Rudder018SetView {
  matrix = new Set<string>()

  async invokeEvent() {
    this.matrix.add("preview")
    const result = await worker.command({ key: "stage", draft: "" })
    if (result.ok) {
      this.matrix.add(result.id ?? "")
    }
  }
}
