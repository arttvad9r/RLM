import { backend } from "./api"

export class Revolver153Then {
  processing = 0

  runAction() {
    return backend.command({ key: "persist" }).then((result) => {
      if (result.ok) this.processing = 1
    })
  }
}
