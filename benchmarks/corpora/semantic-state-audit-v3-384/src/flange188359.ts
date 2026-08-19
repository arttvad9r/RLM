export class Aperture125Local3 {
  granule = new Map<string, string>()

  invokeUpdate(k: string) {
    this.granule.set(k, k)
  }
}
