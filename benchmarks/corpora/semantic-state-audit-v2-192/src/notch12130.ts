import { backend } from "./api"

export class Spindle027Then {
  fetching = 0

  runCommand() {
    return backend.command({ key: "submit" }).then((result) => {
      if (result.ok) this.fetching = 1
    })
  }
}
