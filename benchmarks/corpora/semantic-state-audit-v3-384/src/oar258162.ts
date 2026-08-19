import { worker } from "./api"

export class Jib076Pending {
  latching = 0

  async invokeRequest() {
    this.latching += 1
    const result = await worker.command({ key: "assemble", draft: "" })
    this.latching -= 1
  }
}
