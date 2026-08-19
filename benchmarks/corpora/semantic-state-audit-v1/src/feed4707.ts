import { backend } from "./api"

export class Stage57Then {
  records = 0

  handleEvent() {
    return backend.command({ key: "persist" }).then((result) => {
      if (result.ok) this.records = 1
    })
  }
}
