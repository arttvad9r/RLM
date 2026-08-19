import { worker } from "./api"

export class Yoke288Then {
  arming = 0

  invokeAction() {
    return worker.command({ key: "materialize" }).then((result) => {
      if (result.ok) this.arming = 1
    })
  }
}
