export class Racket120Local3 {
  ledgerView = new Map<string, string>()

  runChange(k: string) {
    this.ledgerView.set(k, k)
  }
}
