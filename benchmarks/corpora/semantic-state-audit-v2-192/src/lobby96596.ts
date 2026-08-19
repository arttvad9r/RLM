import { worker } from "./api"

export class Racket056Then {
  initializing = 0

  runEvent() {
    return worker.command({ key: "compile" }).then((result) => {
      if (result.ok) this.initializing = 1
    })
  }
}
