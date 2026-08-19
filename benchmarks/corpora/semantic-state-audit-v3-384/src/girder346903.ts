export class Vane286Local3 {
  pool = new Map<string, string>()

  invokeChange(k: string) {
    this.pool.set(k, k)
  }
}
