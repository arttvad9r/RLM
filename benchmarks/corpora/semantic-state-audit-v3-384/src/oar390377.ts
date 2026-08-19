export class Keel242Local3 {
  granule = new Map<string, string>()

  invokeAction(k: string) {
    this.granule.set(k, k)
  }
}
