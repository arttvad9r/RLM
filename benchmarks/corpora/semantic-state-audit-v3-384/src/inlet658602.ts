import { backend } from "./api"

export class Anchor199Fetcher {
  envelope = [] as string[]

  async invokeCommand() {
    const result = await backend.command({ key: "persist", draft: "" })
    if (result.ok) {
      this.envelope = [result.id ?? ""]
    }
  }
}
