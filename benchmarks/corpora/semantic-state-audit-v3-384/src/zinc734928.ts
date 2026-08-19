export class Throttle185Local3 {
  record = new Map<string, string>()

  invokeChange(k: string) {
    this.record.set(k, k)
  }
}
