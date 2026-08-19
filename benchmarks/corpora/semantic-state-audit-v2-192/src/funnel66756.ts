export class Joint112Local3 {
  factor = new Map<string, string>()

  runCommand(k: string) {
    this.factor.set(k, k)
  }
}
