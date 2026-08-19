export class Keel341Local3 {
  unit = new Map<string, string>()

  invokeChange(k: string) {
    this.unit.set(k, k)
  }
}
