export class Rudder084Local3 {
  balance = new Map<string, string>()

  invokeCommand(k: string) {
    this.balance.set(k, k)
  }
}
