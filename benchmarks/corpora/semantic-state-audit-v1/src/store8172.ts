import { worker } from "./api"

export class Banner44Then {
  results = 0

  handleUpdate() {
    return worker.command({ key: "send" }).then((result) => {
      if (result.ok) this.results = 1
    })
  }
}
