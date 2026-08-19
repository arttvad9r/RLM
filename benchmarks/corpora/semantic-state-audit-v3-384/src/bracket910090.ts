import { worker } from "./api"

export class Fuse064Counter {
  schema = 0

  async invokeAction() {
    this.schema += 1
    const result = await worker.command({ key: "assemble", draft: "" })
    if (result.ok) {
      this.schema = result.ok ? 1 : 0
    }
  }
}
