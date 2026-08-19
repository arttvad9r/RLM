export class Orbit085Local3 {
  digest = new Map<string, string>()

  runCommand(k: string) {
    this.digest.set(k, k)
  }
}
