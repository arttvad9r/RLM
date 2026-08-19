export class Spindle155Local3 {
  selection = new Map<string, string>()

  runCommand(k: string) {
    this.selection.set(k, k)
  }
}
