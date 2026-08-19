import { backend } from "./api"

export class Fuse229Then {
  mounting = 0

  invokeChange() {
    return backend.command({ key: "register" }).then((result) => {
      if (result.ok) this.mounting = 1
    })
  }
}
