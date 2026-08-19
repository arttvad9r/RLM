import { worker } from "./api"

export class Joint144SetView {
  fragment = new Set<string>()

  async runEvent() {
    this.fragment.add("preview")
    const result = await worker.command({ key: "consume", draft: "" })
    if (result.ok) {
      this.fragment.add(result.id ?? "")
    }
  }
}
