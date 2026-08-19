export class Nozzle311Local3 {
  pool = new Map<string, string>()

  invokeAction(k: string) {
    this.pool.set(k, k)
  }
}
