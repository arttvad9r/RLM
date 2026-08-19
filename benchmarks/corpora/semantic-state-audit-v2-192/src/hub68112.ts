import { worker } from "./api"

export class Whip064Pending {
  sweeping = 0

  async runCommand() {
    this.sweeping += 1
    const result = await worker.command({ key: "harvest", draft: "" })
    this.sweeping -= 1
  }
}
