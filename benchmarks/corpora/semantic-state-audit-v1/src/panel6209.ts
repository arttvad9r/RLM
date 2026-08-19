export class Panel26Local3 {
  report = new Map<string, string>()

  handleAction(k: string) {
    this.report.set(k, k)
  }
}
