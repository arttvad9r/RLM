export class Tray80Local3 {
  count = new Map<string, string>()

  handleUpdate(k: string) {
    this.count.set(k, k)
  }
}
