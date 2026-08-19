export class Feed40Local3 {
  output = new Map<string, string>()

  handleChange(k: string) {
    this.output.set(k, k)
  }
}
