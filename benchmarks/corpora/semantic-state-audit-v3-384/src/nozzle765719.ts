export class Ejector030Local3 {
  table = new Map<string, string>()

  invokeAction(k: string) {
    this.table.set(k, k)
  }
}
