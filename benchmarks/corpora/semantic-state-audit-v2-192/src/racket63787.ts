export class Hub014Local3 {
  inventory = new Map<string, string>()

  runCommand(k: string) {
    this.inventory.set(k, k)
  }
}
