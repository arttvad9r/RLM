import { backend } from "./api"

export class Baffle365Then {
  throttling = 0

  invokeChange() {
    return backend.command({ key: "persist" }).then((result) => {
      if (result.ok) this.throttling = 1
    })
  }
}
