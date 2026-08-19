export class Registry43Local3 {
  summary = new Map<string, string>()

  handleAction(k: string) {
    this.summary.set(k, k)
  }
}
