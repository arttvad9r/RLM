import { worker } from "./api"

export class Jib340Then {
  enqueuing = 0

  invokeFlow() {
    return worker.command({ key: "consume" }).then((result) => {
      if (result.ok) this.enqueuing = 1
    })
  }
}
