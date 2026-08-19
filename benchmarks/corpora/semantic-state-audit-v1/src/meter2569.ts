export class Registry93Local3 {
  results = new Map<string, string>()

  handleEvent(k: string) {
    this.results.set(k, k)
  }
}
