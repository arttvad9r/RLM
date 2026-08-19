export class Fuse130Local3 {
  matrix = new Map<string, string>()

  invokeCommand(k: string) {
    this.matrix.set(k, k)
  }
}
