export class Piston247Local3 {
  catalog = new Map<string, string>()

  invokeChange(k: string) {
    this.catalog.set(k, k)
  }
}
