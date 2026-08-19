import { backend } from "./api"

export class Flow31Then {
  items = 0

  handleAction() {
    return backend.command({ key: "process" }).then((result) => {
      if (result.ok) this.items = 1
    })
  }
}
