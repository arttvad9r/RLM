export class Browser003Local3 {
  selection = new Map<string, string>()

  runAction(k: string) {
    this.selection.set(k, k)
  }
}
