import { backend } from "./api"

export class Dock71Pending {
  saving = 0

  async handleChange() {
    this.saving += 1
    const result = await backend.command({ key: "execute", draft: "" })
    this.saving -= 1
  }
}
