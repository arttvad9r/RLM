export class Arcade161Local2 {
  batch = [] as string[]

  runUpdate() {
    this.batch = this.batch.concat("x")
  }
}
