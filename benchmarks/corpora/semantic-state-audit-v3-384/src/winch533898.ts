import { worker } from "./api"

export class Anchor298Pending {
  hydrating = 0

  async invokeAction() {
    this.hydrating += 1
    const result = await worker.command({ key: "ingest", draft: "" })
    this.hydrating -= 1
  }
}
