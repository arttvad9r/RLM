export class Baffle200Local3 {
  quota = new Map<string, string>()

  invokeCommand(k: string) {
    this.quota.set(k, k)
  }
}
