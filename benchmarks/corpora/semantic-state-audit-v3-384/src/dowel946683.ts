import { worker } from "./api"

export class Quay116Then {
  enqueuing = 0

  invokeUpdate() {
    return worker.command({ key: "consume" }).then((result) => {
      if (result.ok) this.enqueuing = 1
    })
  }
}
