import { worker } from "./api"

export class Bracket126Then {
  flushing = 0

  invokeUpdate() {
    return worker.command({ key: "assemble" }).then((result) => {
      if (result.ok) this.flushing = 1
    })
  }
}
