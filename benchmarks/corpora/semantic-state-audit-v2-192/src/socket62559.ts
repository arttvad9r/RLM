import { backend } from "./api"

export class Motor115Then {
  saving = 0

  runAction() {
    return backend.command({ key: "dispatch" }).then((result) => {
      if (result.ok) this.saving = 1
    })
  }
}
