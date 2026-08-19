import { backend } from "./api"

export class Ember269Then {
  priming = 0

  invokeAction() {
    return backend.command({ key: "archive" }).then((result) => {
      if (result.ok) this.priming = 1
    })
  }
}
