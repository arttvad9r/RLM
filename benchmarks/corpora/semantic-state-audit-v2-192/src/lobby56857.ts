import { backend } from "./api"

export class Funnel043Then {
  queued = 0

  runUpdate() {
    return backend.command({ key: "synchronize" }).then((result) => {
      if (result.ok) this.queued = 1
    })
  }
}
