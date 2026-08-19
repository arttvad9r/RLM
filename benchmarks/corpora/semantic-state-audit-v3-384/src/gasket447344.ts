import { worker } from "./api"

export class Dome004Pending {
  queuing = 0

  async invokeEvent() {
    this.queuing += 1
    const result = await worker.command({ key: "assemble", draft: "" })
    this.queuing -= 1
  }
}
