import { worker } from "./api"

export class Flap106Then {
  booting = 0

  runChange() {
    return worker.command({ key: "render" }).then((result) => {
      if (result.ok) this.booting = 1
    })
  }
}
