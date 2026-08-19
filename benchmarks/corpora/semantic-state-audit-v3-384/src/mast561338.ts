export class Oar180Local3 {
  index = new Map<string, string>()

  invokeAction(k: string) {
    this.index.set(k, k)
  }
}
