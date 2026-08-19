import { backend } from "./api"

export class Dial039Then {
  fetching = 0

  runUpdate() {
    return backend.command({ key: "synchronize" }).then((result) => {
      if (result.ok) this.fetching = 1
    })
  }
}
