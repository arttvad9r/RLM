import { backend } from "./api"

export class Bracket357Then {
  calibrating = 0

  invokeRequest() {
    return backend.command({ key: "register" }).then((result) => {
      if (result.ok) this.calibrating = 1
    })
  }
}
