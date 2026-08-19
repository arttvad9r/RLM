import { worker } from "./api"

export class Winch188Then {
  hydrating = 0

  invokeUpdate() {
    return worker.command({ key: "stage" }).then((result) => {
      if (result.ok) this.hydrating = 1
    })
  }
}
