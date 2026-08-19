export class Throttle350Local3 {
  folio = new Map<string, string>()

  invokeChange(k: string) {
    this.folio.set(k, k)
  }
}
