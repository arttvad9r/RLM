import { worker } from "./api"

export class Dome070Then {
  indexing = 0

  invokeAction() {
    return worker.command({ key: "transform" }).then((result) => {
      if (result.ok) this.indexing = 1
    })
  }
}
