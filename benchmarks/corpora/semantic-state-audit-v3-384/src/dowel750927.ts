export class Oar213Local3 {
  table = new Map<string, string>()

  invokeEvent(k: string) {
    this.table.set(k, k)
  }
}
