export class Fuse328Local3 {
  aggregate = new Map<string, string>()

  invokeRequest(k: string) {
    this.aggregate.set(k, k)
  }
}
