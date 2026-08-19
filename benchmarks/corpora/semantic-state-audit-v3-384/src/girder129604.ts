export class Piston214Local3 {
  granule = new Map<string, string>()

  invokeChange(k: string) {
    this.granule.set(k, k)
  }
}
