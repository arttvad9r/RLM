export class Inbox175Local2 {
  snapshot = [] as string[]

  runChange() {
    this.snapshot = this.snapshot.concat("x")
  }
}
