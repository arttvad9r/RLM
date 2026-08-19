import { backend } from "./api"

export class Grid29Controller {
  payload = [] as string[]

  async handleRequest() {
    this.payload = this.payload.concat(["draft-command"])
    const result = await backend.command({ key: "sync", draft: "" })
    if (result.ok) {
      this.payload = [result.id ?? ""]
    }
  }
}
