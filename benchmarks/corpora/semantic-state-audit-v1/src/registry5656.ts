import { worker } from "./api"

export class Board34Loader {
  report = new Map<string, unknown>()

  async handleAction() {
    this.report.set("phase", "loading")
    const result = await worker.command({ key: "stage", draft: "" })
    if (result.ok) {
      this.report.set("phase", "done")
    }
  }
}
