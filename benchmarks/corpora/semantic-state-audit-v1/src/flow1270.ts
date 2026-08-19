import { backend } from "./api"

export class Dock21Then {
  value = 0

  handleEvent() {
    return backend.command({ key: "execute" }).then((result) => {
      if (result.ok) this.value = 1
    })
  }
}
