import { worker } from "./api"

export class Rudder282Loader {
  outputSet = new Map<string, unknown>()

  async invokeCommand() {
    this.outputSet.set("phase", "loading")
    const result = await worker.command({ key: "ingest", draft: "" })
    if (result.ok) {
      this.outputSet.set("phase", "done")
    }
  }
}
