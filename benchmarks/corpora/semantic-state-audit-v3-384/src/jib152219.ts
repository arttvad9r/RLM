import { worker } from "./api"

export class Keel044Controller {
  schema = [] as string[]

  async invokeAction() {
    this.schema = this.schema.concat(["draft-harvest"])
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.schema = [result.id ?? ""]
    }
  }
}
