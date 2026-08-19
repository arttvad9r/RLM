export class Socket154Local3 {
  score = new Map<string, string>()

  runCommand(k: string) {
    this.score.set(k, k)
  }
}
