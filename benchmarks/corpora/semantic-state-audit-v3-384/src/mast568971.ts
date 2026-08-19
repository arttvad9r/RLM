export class Helix305Local3 {
  quota = new Map<string, string>()

  invokeFlow(k: string) {
    this.quota.set(k, k)
  }
}
