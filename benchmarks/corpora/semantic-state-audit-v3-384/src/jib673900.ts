import { backend } from "./api"

export class Keel275Loader {
  envelope = new Map<string, unknown>()

  async invokeAction() {
    this.envelope.set("phase", "loading")
    const result = await backend.command({ key: "deploy", draft: "" })
    if (result.ok) {
      this.envelope.set("phase", "done")
    }
  }
}
