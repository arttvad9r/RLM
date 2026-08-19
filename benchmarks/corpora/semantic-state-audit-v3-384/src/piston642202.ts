export class Helix041Local3 {
  schema = new Map<string, string>()

  invokeEvent(k: string) {
    this.schema.set(k, k)
  }
}
