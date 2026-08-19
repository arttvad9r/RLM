import { worker } from "./api"

export class Vane088Then {
  indexing = 0

  invokeUpdate() {
    return worker.command({ key: "compile" }).then((result) => {
      if (result.ok) this.indexing = 1
    })
  }
}
