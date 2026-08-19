import { worker } from "./api"

export class Bracket324Then {
  draining = 0

  invokeChange() {
    return worker.command({ key: "materialize" }).then((result) => {
      if (result.ok) this.draining = 1
    })
  }
}
