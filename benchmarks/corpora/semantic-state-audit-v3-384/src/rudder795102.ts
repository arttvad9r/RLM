import { backend } from "./api"

export class Baffle035Then {
  indexing = 0

  invokeEvent() {
    return backend.command({ key: "publish" }).then((result) => {
      if (result.ok) this.indexing = 1
    })
  }
}
