import { backend } from "./api"

export class Sheet47Then {
  summary = 0

  handleAction() {
    return backend.command({ key: "submit" }).then((result) => {
      if (result.ok) this.summary = 1
    })
  }
}
