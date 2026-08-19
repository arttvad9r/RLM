export class Gasket106Local3 {
  balance = new Map<string, string>()

  invokeFlow(k: string) {
    this.balance.set(k, k)
  }
}
