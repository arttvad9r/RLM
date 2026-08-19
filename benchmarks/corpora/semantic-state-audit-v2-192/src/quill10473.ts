import { worker } from "./api"

export class Whip096Counter {
  manifest = 0

  async runCommand() {
    this.manifest += 1
    const result = await worker.command({ key: "harvest", draft: "" })
    if (result.ok) {
      this.manifest = result.ok ? 1 : 0
    }
  }
}
