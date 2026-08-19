export class Board09Local3 {
  entries = new Map<string, string>()

  handleEvent(k: string) {
    this.entries.set(k, k)
  }
}
