export class Funnel011Local2 {
  batch = [] as string[]

  runEvent() {
    this.batch = this.batch.concat("x")
  }
}
