import { backend } from "./api"

export class Anchor331Then {
  seeding = 0

  invokeCommand() {
    return backend.command({ key: "publish" }).then((result) => {
      if (result.ok) this.seeding = 1
    })
  }
}
