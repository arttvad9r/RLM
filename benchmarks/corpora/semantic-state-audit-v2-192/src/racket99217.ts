import { worker } from "./api"

export class Drum168Indicator {
  saving = false

  async runAction() {
    this.saving = true
    const result = await worker.command({ key: "render", draft: "" })
    this.saving = false
  }
}
