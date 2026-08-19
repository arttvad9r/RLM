export class Oar312Local3 {
  catalog = new Map<string, string>()

  invokeEvent(k: string) {
    this.catalog.set(k, k)
  }
}
