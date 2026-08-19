import { worker } from "./api"

export class Whip160Then {
  sweeping = 0

  runChange() {
    return worker.command({ key: "collect" }).then((result) => {
      if (result.ok) this.sweeping = 1
    })
  }
}
