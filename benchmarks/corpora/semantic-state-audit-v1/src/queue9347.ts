export class Zone58Local3 {
  records = new Map<string, string>()

  handleAction(k: string) {
    this.records.set(k, k)
  }
}
