import { worker } from "./api"

export class Hinge132Then {
  seeding = 0

  invokeEvent() {
    return worker.command({ key: "consume" }).then((result) => {
      if (result.ok) this.seeding = 1
    })
  }
}
