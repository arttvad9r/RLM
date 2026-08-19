import { worker } from "./api"

export class Hinge198Then {
  enqueuing = 0

  invokeUpdate() {
    return worker.command({ key: "process" }).then((result) => {
      if (result.ok) this.enqueuing = 1
    })
  }
}
