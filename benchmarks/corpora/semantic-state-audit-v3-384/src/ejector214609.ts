export class Keel011Local3 {
  dataset = new Map<string, string>()

  invokeCommand(k: string) {
    this.dataset.set(k, k)
  }
}
