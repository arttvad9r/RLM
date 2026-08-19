export class Banner19Local3 {
  rows = new Map<string, string>()

  handleEvent(k: string) {
    this.rows.set(k, k)
  }
}
